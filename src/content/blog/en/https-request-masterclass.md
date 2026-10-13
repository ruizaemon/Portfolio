---
title: What really happens when your browser sends an HTTPS request
description: A deep dive into the layers between your code and the wire. Where TCP, TLS and HTTP actually live, how a connection is set up, kept honest and torn down, and why the fastest request is the one that reuses a connection.
pubDate: 2026-10-13
lang: en
---

I've spent the last while studying networking fundamentals: the OSI model, switches and routers, ARP, subnetting, the usual. That gets you to layer 3. It explains how a packet finds its way from my laptop to a server, but it doesn't explain the part I touch every day as a web developer: what happens *inside* that packet, and above it, when I call `fetch()` or `requests.get()`.

This post is my attempt to fill that gap properly, from the socket call down to layer 4 and back up through TLS to HTTP. It follows a single request, `GET https://api.example.com/orders`, from the moment the browser decides to send it until a handler function runs on the server, and it tries to answer the questions I actually had along the way. The diagrams are hand-drawn SVG, so they follow the site's light and dark themes.

I'll assume you know what IP addresses, ports, MAC addresses and routers are. Everything else is explained as it comes up.

<nav class="toc" aria-label="On this page">

**On this page**

- [Where the layers actually live](#where-the-layers-actually-live)
- [Before the first packet: filling in the addresses](#before-the-first-packet-filling-in-the-addresses)
- [TCP: turning best-effort packets into a reliable stream](#tcp-turning-best-effort-packets-into-a-reliable-stream)
  - [The three-way handshake](#the-three-way-handshake)
  - [Segments, sequence numbers and the byte stream](#segments-sequence-numbers-and-the-byte-stream)
  - [Reliability: ACKs and retransmission](#reliability-acks-and-retransmission)
  - [Flow control and congestion control](#flow-control-and-congestion-control)
  - [Closing a connection](#closing-a-connection)
  - [What the TCP header actually contains](#what-the-tcp-header-actually-contains)
- [UDP: the honest minimum](#udp-the-honest-minimum)
- [TLS: a private, authenticated byte stream](#tls-a-private-authenticated-byte-stream)
  - [The TLS 1.3 handshake](#the-tls-13-handshake)
  - [Certificates and the chain of trust](#certificates-and-the-chain-of-trust)
  - [Records: how TLS frames the stream](#records-how-tls-frames-the-stream)
  - [Resumption and 0-RTT](#resumption-and-0-rtt)
  - [Who terminates TLS](#who-terminates-tls)
- [HTTP: the part your code actually sees](#http-the-part-your-code-actually-sees)
  - [HTTP/1.1: text, and one thing at a time](#http11-text-and-one-thing-at-a-time)
  - [HTTP/2: frames and streams](#http2-frames-and-streams)
  - [HTTP/3 and QUIC: leaving TCP behind](#http3-and-quic-leaving-tcp-behind)
- [Counting round trips](#counting-round-trips)
- [The server side: where each layer ends](#the-server-side-where-each-layer-ends)
- [See it for yourself](#see-it-for-yourself)
- [Questions I had, answered](#questions-i-had-answered)
- [Further reading](#further-reading)

</nav>

## Where the layers actually live

The first thing that made the layer model click for me was realising that it's a map of *responsibilities*, not a list of separate programs. There is no "layer 4 process" on your machine. Each layer is handled by whatever piece of software owns that job, and most of them are not yours.

<div data-diagram="net-stack-ownership"></div>

The boundary that matters for a developer is the **socket API**. Everything you write, and every library you use, talks to the network through a handful of system calls: `connect()`, `send()`, `recv()`, `close()`. On the far side of those calls, the kernel owns TCP, IP and Ethernet. Your process never sees a TCP header, never sees a packet, and has no say in how the data is split up on the wire. It hands over bytes and gets bytes back.

TLS is the interesting exception. It is not in the kernel; it's a library (OpenSSL, BoringSSL, rustls, the one built into Node or Go) that your process links against. It sits *between* your HTTP code and the socket, encrypting what you send and decrypting what arrives. Your HTTP code still sees plain bytes, just as if the connection weren't encrypted at all.

Here is literally everything `requests.get("https://api.example.com/orders")` does, written out with the standard library:

```python
import socket, ssl

ctx = ssl.create_default_context()  # loads the OS trust store

# DNS lookup + TCP handshake
with socket.create_connection(("api.example.com", 443)) as tcp:
    # TLS handshake; server_hostname becomes the SNI and is checked against the certificate
    with ctx.wrap_socket(tcp, server_hostname="api.example.com") as tls:
        tls.sendall(b"GET /orders HTTP/1.1\r\nHost: api.example.com\r\nConnection: close\r\n\r\n")
        while chunk := tls.recv(4096):  # a byte stream: it arrives in whatever pieces it arrives in
            print(chunk.decode(), end="")
```

Three lines do the real work: one call sets up TCP, one sets up TLS, and one writes an HTTP request as text into the stream. The rest of this post is about what each of those lines causes to happen.

One practical note on the model: there are no separate layer 5 or layer 6 headers in a real HTTPS request. The OSI model was designed for a different protocol family. In practice you have Ethernet (2), IP (3), TCP (4), TLS (somewhere in 5–6, if you insist) and HTTP (7). The TCP/IP model, with its four layers, is the honest description of what's on the wire.

## Before the first packet: filling in the addresses

A TCP connection is identified by four numbers: source IP, source port, destination IP, destination port. Before the first packet can leave, all four have to be decided, and the interesting part is that your code only decides two of them.

<div data-diagram="net-four-tuple"></div>

**The destination IP** comes from DNS. The browser takes the hostname out of the URL and resolves it, checking its own cache, then asking the operating system, which checks `/etc/hosts` and its own cache before sending a query to the recursive resolver it was configured with (your router, your ISP, or something like `1.1.1.1`). That resolver walks the DNS hierarchy if it has to and returns the `A` (IPv4) and `AAAA` (IPv6) records. If both exist, modern clients race them: this is called **Happy Eyeballs**. The client starts connecting over IPv6, and if that hasn't succeeded within about a quarter of a second it starts an IPv4 attempt in parallel and uses whichever wins. If the URL has an IP literal in it, `https://93.184.216.34/`, this whole step is skipped.

**The destination port** comes from the URL too. If it has an explicit port, `https://localhost:8443/`, that's used. Otherwise the scheme's well-known default applies:

| Scheme | Default port | Scheme | Default port |
| --- | --- | --- | --- |
| `http://` | **80** | `ssh://` | **22** |
| `https://` | **443** | `postgres://` | **5432** |
| `ws://` / `wss://` | **80** / **443** | `redis://` | **6379** |

This is the whole reason web servers listen on 80 and 443: browsers assume those numbers, so a URL works without anyone typing a port. There's nothing magic about the numbers themselves; a server listening on 8443 works exactly the same way, it just needs the port spelled out.

**The source IP** is chosen by the kernel when `connect()` is called. It looks up the destination in its routing table, finds the interface it would send through, and uses that interface's address. On a laptop with Wi-Fi this is your `192.168.x.x` address.

**The source port** is also the kernel's choice: a random number from the ephemeral range, which is 32768–60999 on Linux (`cat /proc/sys/net/ipv4/ip_local_port_range`). It only has to be unique for this combination of destination IP and port, which is why one machine can have tens of thousands of simultaneous connections even though it only has about 28,000 ephemeral ports.

Those four values together are the connection's identity on both machines. When a packet arrives, the kernel looks up this **four-tuple** to find the socket it belongs to. This is also the answer to a question that confused me for a long time: a server has *one* port 443, so how does it keep thousands of clients apart? Because each client's packets carry a different source IP and source port, and the four-tuple is what the kernel keys on, not the destination port alone.

<details class="explainer">
<summary>Where the MAC address fits, and what NAT changes</summary>

The next-hop MAC is a layer 2 concern and is different in kind from the four fields above. For a destination outside your subnet, the kernel ARPs for the *gateway's* MAC, not the server's, and puts that in the Ethernet frame. Every router along the path strips that frame and writes a new one for the next link. The destination IP stays the same all the way; the MAC changes at every hop.

There's one common exception to "the IP addresses stay the same", and it's sitting in your home: **NAT**. Your router rewrites the source IP and port of every outgoing packet to its own public address and a port it chose, and keeps a table to reverse the mapping on the way back. The server sees your router's public IP, not your `192.168.x.x` one, and a different source port from the one your kernel picked. From the server's point of view, everyone in your house is one client with many ports. This is why a server can't use the source IP to identify a user, and it's why cloud load balancers add `X-Forwarded-For` (more on that later).

</details>

<details class="explainer">
<summary>Finding ports through DNS</summary>

A few protocols discover their port instead of assuming it. `SRV` records (`_xmpp-client._tcp.example.com`) carry a hostname and port, and are used by XMPP, SIP, Minecraft and others. The newer `HTTPS` record type does something similar for the web, and also tells the browser upfront that the server supports HTTP/3 and which port to use for it, saving a round trip of discovery. Browsers support `HTTPS` records today; plain `SRV` was never adopted for HTTP.

</details>

## TCP: turning best-effort packets into a reliable stream

Everything IP gives you is a packet that *might* arrive. It might also arrive twice, arrive out of order, arrive corrupted, or not arrive at all, and it can't be larger than the path allows (about 1500 bytes on Ethernet). That is a perfectly good foundation but a terrible thing to write an application on. TCP's job is to take that and present your program with something simple: a two-way stream of bytes that arrive in order, exactly once, as fast as the path allows and no faster.

To do that, it has to handle five things: setting up a connection, numbering the data, detecting and repairing loss, not overwhelming the receiver, and not overwhelming the network. Let's take them one at a time.

### The three-way handshake

A TCP connection starts with three messages.

<div data-diagram="net-tcp-handshake"></div>

Why three? Because each side has to tell the other its **initial sequence number** (ISN) and get confirmation that it was heard. The client's SYN carries its ISN, *x*. The server's SYN-ACK does two jobs at once: it acknowledges *x* (by saying "the next byte I expect is *x* + 1") and carries the server's own ISN, *y*. The client's ACK acknowledges *y*. Two messages would leave the server unsure whether its ISN had been received; three is the minimum for both sides to know the other is really there and agree on numbering.

The sequence numbers are random on purpose. If they always started at 0, an attacker who couldn't see your traffic could still guess valid packets to inject, and a late packet from an earlier connection on the same ports could be mistaken for part of the new one.

A few details that matter in practice:

- **`connect()` returns when the SYN-ACK arrives.** From the client's point of view the connection exists before the server has even seen the final ACK. The client can put data in the same packet as that ACK, which is exactly what happens with TLS: the ClientHello rides along with it.
- **The server has to be `listen()`ing.** A listening socket is a different kind of socket from a connected one. It holds a queue of half-open connections (SYN received, ACK not yet) and a queue of fully established ones waiting for the application to call `accept()`. When those queues overflow under a flood of SYNs, the kernel can switch to *SYN cookies*, encoding the connection state into the ISN itself so it doesn't have to store anything.
- **If nothing is listening**, the server's kernel answers the SYN with a **RST** (reset). That's what "connection refused" means: something is there, and it said no. "Connection timed out" is different: no answer at all, usually because a firewall silently dropped the SYN or the host is down.
- The handshake costs **one full round trip** before any data can be sent. That number comes back later.

### Segments, sequence numbers and the byte stream

This is the concept that took me longest to really get: TCP is a **byte stream**, and packets are not part of its contract with you.

<div data-diagram="net-byte-stream"></div>

When your code calls `send()` with 4000 bytes, the kernel does not send a 4000-byte packet. It cuts the data into **segments** no larger than the **MSS** (maximum segment size), which both sides advertised during the handshake. On a normal Ethernet path the MTU is 1500 bytes; subtract 20 for the IP header and 20 for the TCP header and you get an MSS of 1460. So 4000 bytes become three segments of 1460, 1460 and 1080.

Each segment carries the sequence number of its first byte. The sequence number counts *bytes*, not packets: the second segment says "I start at byte 1460". That is the whole trick. If the second segment arrives before the first, the receiver knows exactly where it goes. If one is lost, the receiver knows exactly which bytes are missing. If one arrives twice, the receiver recognises the duplicate range and drops it.

Having reassembled the bytes in order, the kernel puts them in the socket's receive buffer, and `recv()` returns whatever is there up to the size you asked for. It has no idea, and no record, of how the data was segmented. That is why:

- **One `send()` is not one `recv()`.** 4000 bytes sent as 1460 + 1460 + 1080 may be read back as 2000 + 2000, or 4000, or 1460 + 2540, depending on timing.
- **Small sends can be merged.** Call `send()` three times with 10 bytes each and they may well travel in one segment. By default the kernel delays small segments while earlier data is still unacknowledged, to avoid flooding the network with tiny packets (this is **Nagle's algorithm**; `TCP_NODELAY` turns it off, which every latency-sensitive protocol does).
- **Anything built on TCP has to do its own framing.** The stream gives you no boundaries, so each protocol invents its own. TLS puts a 5-byte header with a length in front of every record. HTTP/1.1 ends its headers with a blank line and then uses `Content-Length` or chunked encoding to say how long the body is. HTTP/2 prefixes every frame with its length. A protocol that forgets this (reading "one message" per `recv()`) works on localhost and breaks the first time it meets a real network.

UDP is the contrast: there, each `send()` is exactly one datagram, and the receiver gets it whole or not at all. Boundaries preserved, everything else lost.

### Reliability: ACKs and retransmission

The receiver tells the sender what it has received with **acknowledgements**. An ACK carries one number: the next byte the receiver is waiting for. "ACK 1461" means "I have every byte up to 1460; send me 1461 next". ACKs are cumulative, which is efficient (one ACK can confirm many segments) but also means a lost segment makes the ACK number stick.

<div data-diagram="net-tcp-retransmit"></div>

The sender keeps a copy of every unacknowledged segment and a timer. If the timer fires before the ACK arrives, it resends. That timer, the **RTO**, is derived from the measured round-trip time, with a floor of 200 ms on Linux, and it doubles on each failure. But waiting for it is slow. The usual way loss gets repaired is **fast retransmit**: when the receiver gets a segment it wasn't expecting (segment 3 when it wanted 2), it immediately sends another ACK for the byte it's still waiting for. Three of those duplicate ACKs in a row tell the sender exactly which segment is missing, and it resends that one segment without waiting for the timer.

Modern stacks also use **selective acknowledgements** (SACK), a TCP option in which the receiver lists the ranges it *does* have beyond the gap, so the sender resends only what's actually missing instead of everything after it.

Note what reliability does to latency. The bytes after the gap sit in the receive buffer, fully arrived, and your `recv()` can't have them until the gap is filled. One lost packet stalls everything behind it. Remember that for HTTP/2.

<details class="explainer">
<summary>Delayed ACKs, and a classic 40 ms stall</summary>

To cut down on tiny packets, a receiver doesn't ACK every segment the moment it arrives; it waits briefly (up to 40 ms on Linux) hoping to piggyback the ACK on data of its own, or to ACK two segments at once. Harmless on its own. But combine it with Nagle's algorithm on the other side, which holds a small segment until the previous one is ACKed, and you get a deadlock that resolves only when the delayed-ACK timer fires. Request-response protocols that send a small header and a small body as two writes hit this constantly. The symptom is a flat 40 ms added to some requests; the fix is `TCP_NODELAY`, which is why every HTTP library and database driver sets it.

</details>

### Flow control and congestion control

A sender could shovel segments out as fast as the network card allows. Two things stop it, and it's worth keeping them separate in your head because they solve different problems.

<div data-diagram="net-windows"></div>

**Flow control protects the receiver.** Every ACK carries a **window** field: the amount of free space left in the receiver's buffer. The sender must never have more than that many unacknowledged bytes in flight. If the receiving application is slow to call `recv()`, the buffer fills, the window shrinks towards zero, and the sender stops. This is *backpressure*, and it propagates: a slow consumer at the very end of a pipeline eventually stalls the producer at the start without anyone writing code for it. (The window field is 16 bits, so 64 KB; a handshake option called *window scaling* multiplies it so modern connections can have megabytes in flight.)

**Congestion control protects the network.** Nothing in the path tells the sender how much capacity there is, so it has to find out by probing. It keeps a second limit, the **congestion window** (cwnd), that never leaves the sender's machine, and it may only have `min(rwnd, cwnd)` bytes in flight. A new connection starts with a cwnd of 10 segments (about 14 KB) and in **slow start** doubles it every round trip. When a loss is detected, the sender takes that as a congestion signal, cuts cwnd (roughly in half, depending on the algorithm) and grows it again slowly, about one segment per round trip. That is the sawtooth. The default algorithm on Linux is CUBIC; BBR, which estimates bandwidth and delay directly instead of waiting for loss, is used by Google, Cloudflare and others.

Two consequences follow that show up in real systems:

- **A new connection is slow for its first few round trips** no matter how fast the link is. Transferring 1 MB over a fresh connection on an 80 ms path takes several round trips of slow start before cwnd is large enough to use the bandwidth. A connection that's already been used has a warmed-up cwnd. This is the second reason (after handshakes) that connection reuse matters so much.
- **Bandwidth × delay is the real limit.** To keep a 100 Mbit/s link busy over an 80 ms round trip, you need 1 MB in flight, continuously. A single connection with a small window can't do it; this is why a download from another continent is often slower than the link, and part of why CDNs put servers close to you.

### Closing a connection

Each direction of a TCP connection is closed separately, so a clean shutdown takes four messages.

<div data-diagram="net-tcp-close"></div>

When your code calls `close()`, the kernel sends a **FIN**: "I have nothing more to send". The other side ACKs it, and can keep sending data for as long as it likes; this is a *half-closed* connection, and some protocols rely on it (the client finishes writing its request, then reads the whole response). When the other side is done, it sends its own FIN, and the first side ACKs that.

The side that closed first then enters **TIME_WAIT** and stays there for twice the *maximum segment lifetime*, a fixed 60 seconds on Linux. The reason is subtle: if that last ACK is lost, the other side will resend its FIN, and someone has to be around to re-ACK it. And more importantly, any stray packets from this connection still wandering the network must be given time to die before the same four-tuple can be reused for a new connection, where they would be mistaken for new data. It is a feature, but it has a cost: a server that actively closes thousands of short connections per second accumulates tens of thousands of sockets in TIME_WAIT, each tying up a four-tuple. This is one of the reasons HTTP keeps connections open and reuses them, and why it's usually better for the *client* to close.

The other way a connection ends is a **RST**. It's a single packet, it's immediate, and it means "there is no connection here" or "I'm abandoning this one". You get a RST when you connect to a port nobody is listening on, when a process dies with connections open, when a firewall or load balancer decides a connection has been idle too long and drops its state, or when data arrives for a socket that's already been closed. "Connection reset by peer" is your kernel reporting one.

### What the TCP header actually contains

For reference, this is the 20 bytes (plus options) in front of every segment. Everything above comes down to these fields.

| Field | Size | What it's for |
| --- | --- | --- |
| Source port, destination port | 16 bits each | Which socket on each machine, together with the IP addresses |
| Sequence number | 32 bits | The byte offset of the first byte in this segment |
| Acknowledgement number | 32 bits | The next byte the sender of this segment expects to receive |
| Flags | 9 bits | `SYN`, `ACK`, `FIN`, `RST`, `PSH` (deliver now), `URG`, and two for congestion notification |
| Window | 16 bits | Receive window: free buffer space, scaled by the window-scale option |
| Checksum | 16 bits | Covers the header, data and the IP addresses |
| Options | variable | `MSS` and *window scale* (handshake only), *SACK permitted* / *SACK* blocks, *timestamps* for RTT measurement |

There is no length field: the segment's data length is worked out from the IP header's length minus the headers. And there is nothing about the application in here at all. TCP has no idea it's carrying HTTPS.

## UDP: the honest minimum

UDP is what you get when you take IP and add just enough to reach the right application: an 8-byte header with a source port, a destination port, a length and a checksum. That's it.

| | TCP | UDP |
| --- | --- | --- |
| Connection | Yes, handshake first | No; just send |
| Unit | Byte stream, no boundaries | Datagrams, boundaries kept |
| Ordering | Guaranteed | None |
| Loss | Detected and repaired | Your problem |
| Flow and congestion control | Built in | Your problem |
| Header | 20 bytes + options | 8 bytes |
| Typical users | HTTP/1.1, HTTP/2, SSH, databases, email | DNS, HTTP/3 (QUIC), video calls, games, NTP, DHCP |

The folk wisdom is that "UDP is faster". Per packet, it isn't; a UDP datagram and a TCP segment travel the same path at the same speed. What UDP lets you skip is the *waiting*: no handshake before the first byte, no stall behind a lost packet, no congestion window ramping up. For a DNS query, one datagram each way, a handshake would triple the cost. For a video call, a lost frame is worth nothing 100 ms later, so retransmitting it is a waste; better to skip it and keep going. For a game, the latest position matters and the old one doesn't.

UDP is also what you build on when you want TCP's guarantees but on your own terms. QUIC, the transport under HTTP/3, is "TCP done again in user space on top of UDP", with reliability and congestion control reimplemented so they can be changed without waiting for every operating system on earth to update its kernel. More on that below.

The thing to internalise: UDP doesn't give you less reliability, it gives you *no* reliability, and every protocol on top of it that needs some has to build exactly what it needs.

## TLS: a private, authenticated byte stream

Everything so far is visible to anyone on the path. TLS sits between TCP and HTTP and turns TCP's byte stream into one that has three properties:

- **Confidentiality:** nobody on the path can read it.
- **Integrity:** nobody on the path can change it without the change being detected.
- **Authentication:** the client knows it's talking to the server named in the URL, not to someone in the middle. (Client authentication is possible too, with client certificates, and is how *mutual TLS* works between services, but the web generally does that at the HTTP layer with cookies and tokens.)

From HTTP's point of view, TLS is invisible: it writes bytes into the TLS library and reads bytes out, exactly as it would with a plain socket. From TCP's point of view it's also invisible: it's just bytes. TLS is purely a transformation applied in the middle.

### The TLS 1.3 handshake

Before any of that can happen, the two sides need to agree on keys. TLS 1.3, which is what nearly all of the web uses now, does it in one round trip.

<div data-diagram="net-tls-handshake"></div>

1. **ClientHello.** The client sends the list of cipher suites it supports, a random value, and three things worth knowing by name:
   - A **key share**: the public half of a fresh ephemeral key pair (usually an X25519 curve point). The private half never leaves the client.
   - **SNI** (Server Name Indication): the hostname from the URL, in plain text. The server needs it before it can pick a certificate, and a single IP address usually hosts many sites, so it can't be inferred from the destination. This is the one piece of HTTPS metadata that leaks; see the explainer below.
   - **ALPN** (Application-Layer Protocol Negotiation): the list of application protocols the client speaks, typically `h2, http/1.1`. This is how HTTP/2 gets negotiated without an extra round trip.
2. **ServerHello.** The server picks a cipher suite and sends its own key share. At this moment both sides can compute the same shared secret: each combines its own private key with the other's public key, and the maths (elliptic-curve Diffie–Hellman) guarantees they get the same answer, while an observer who saw both public halves cannot. The secret itself is never transmitted. From this secret both derive the symmetric keys (AES-GCM or ChaCha20-Poly1305) that will encrypt everything from here on.
3. **Encrypted server messages**, in the same flight: `EncryptedExtensions` (including the chosen ALPN protocol), the **Certificate** chain, **CertificateVerify** (a signature over the handshake so far, made with the private key that belongs to the certificate, proving the server actually holds it), and **Finished** (a checksum of the whole handshake, so any tampering with the earlier plaintext messages is detected). All of this is already encrypted with the handshake keys, which is why TLS 1.3 hides the certificate from observers; TLS 1.2 sent it in the clear.
4. **Client Finished.** The client verifies the certificate chain and the signature, sends its own Finished, and, crucially, **sends the HTTP request in the same flight**. It doesn't wait for anything else.

So from the client's point of view: one round trip to get the server's key share and certificate, and the request leaves immediately after. TLS 1.2 needed two round trips, because the key exchange and the certificate check happened in separate steps.

Two more things fall out of the ephemeral keys. First, **forward secrecy**: the key pair is thrown away after the handshake, so even if the server's long-term private key is stolen next year, recordings of today's traffic can't be decrypted. Second, the server's long-term key is used only for *signing* in CertificateVerify, never for encrypting; that's what makes the first point possible.

<details class="explainer">
<summary>What HTTPS hides, and what it doesn't</summary>

Hidden from anyone on the path: the URL's path and query string, all headers (including cookies and authorization tokens), the request and response bodies, and the HTTP method and status code. If you see a URL like `https://example.com/account/settings?user=42` in a log, only `example.com` was ever visible on the wire.

Visible: the server's IP address (it's in every packet), the hostname via SNI (plain text in the ClientHello), the DNS lookup that preceded the connection (unless you use DNS over HTTPS/TLS), and the *sizes and timing* of everything, which is more revealing than it sounds. **Encrypted Client Hello** (ECH) is a newer extension that encrypts the SNI using a key published in DNS; Cloudflare and the major browsers support it, so the hostname leak is slowly closing.

</details>

### Certificates and the chain of trust

The handshake proves the server holds *a* private key. The certificate is what ties that key to a name.

<div data-diagram="net-cert-chain"></div>

A certificate is a signed statement: "this public key belongs to `api.example.com`, valid from this date to that date, says *issuer*". The issuer is a **certificate authority** (CA), and its statement is only worth something if the client already trusts the CA. Your operating system and browser ship with a list of around 150 **root CAs**, and that list is the foundation of the whole system.

In practice roots don't sign server certificates directly; they sign **intermediate** CAs, which sign the server certificates, so the root's private key can stay offline. The server sends its own certificate *and* the intermediates during the handshake (a frequent misconfiguration is forgetting the intermediate, which works in browsers that cache it and fails in `curl`). The client walks the chain: is the server cert signed by the intermediate? Is the intermediate signed by a root in my store? Then it checks the dates, checks that the hostname it connected to matches one of the names in the certificate's *Subject Alternative Name* list, and, with varying enthusiasm, checks that nothing in the chain has been revoked.

Since Let's Encrypt made certificates free and automatable in 2015, most of the web uses 90-day certificates renewed by a script, and the lifetime is heading down further. A short lifetime limits the damage from a stolen key and makes revocation, which never really worked, matter less.

### Records: how TLS frames the stream

TLS has the same problem every protocol on TCP has: the stream has no boundaries, and it can't decrypt "some bytes", it needs a complete unit. So it defines its own: the **record**.

<div data-diagram="net-framing"></div>

Every record starts with a 5-byte header: a type, a version, and a 16-bit length. The payload is up to 16 KB of encrypted data followed by an authentication tag. The receiver reads 5 bytes from the TCP stream, learns the length, reads that many more, decrypts and verifies the record as a unit, and hands the plaintext up to HTTP. If a single bit was changed in transit the tag won't verify and the connection is torn down.

The thing I find clarifying about the diagram is that the three sets of boundaries have nothing to do with each other. TCP cut the stream wherever the MSS fell. TLS cut it into records wherever the library's buffer filled. HTTP cut it into a status line, headers and a body using its own rules. Each layer reads its own length fields out of the layer below and is completely unaware of the others' framing. A TLS record can span three TCP segments; an HTTP header can span two TLS records; nothing cares.

### Resumption and 0-RTT

A full handshake needs the server to send its certificate and do a signature, and the client to verify a chain, each time. TLS has always had ways to shortcut this on repeat visits, and TLS 1.3 cleaned them up into one mechanism: after the first handshake, the server can send a **session ticket**, an encrypted blob holding the connection's secret that only the server can decrypt. On the next connection the client presents the ticket in its ClientHello, and both sides derive new keys from the old secret plus fresh key shares. No certificate, no signature, still one round trip.

The spicier option is **0-RTT**: with a ticket in hand, the client can encrypt the HTTP request with keys derived from the *old* secret and send it in the very first flight, alongside the ClientHello. The server can act on it before the handshake completes. The catch is that this *early data* is replayable: an attacker who recorded that first flight can send it again, and the server can't tell the difference. So 0-RTT is only safe for requests that are harmless to repeat, which means idempotent `GET`s and nothing that charges a credit card. Most servers either disable it or restrict it to GETs, and most clients don't use it by default.

### Who terminates TLS

TLS ends wherever the certificate's private key lives, and that is not necessarily your application.

- **In the app server** (uvicorn, Node, Go's `net/http` with a cert configured): the simple case, and the diagram above. The TLS library runs inside your process.
- **In a reverse proxy on the same host** (nginx, Caddy): nginx holds the certificate, decrypts, and talks plain HTTP to your app on `localhost:8000`. Your app never sees TLS at all.
- **In a load balancer** (an AWS ALB, Google's HTTPS load balancer, Cloudflare): same idea, one network hop earlier. The load balancer terminates TCP *and* TLS, parses the HTTP request, and opens its own, usually unencrypted, TCP connection to your server on a private network. Because that is a completely new connection with the load balancer as its source, your app sees the load balancer's IP, which is why it adds `X-Forwarded-For` (the client's real IP) and `X-Forwarded-Proto: https` (so your app knows the user connected securely even though the hop it sees is plain HTTP).

A layer 4 load balancer (an AWS NLB) is different: it forwards TCP packets without opening them, so TLS still terminates on your server, and your server sees the real client IP in the packets. I went through the two kinds, with diagrams of exactly which headers each one rewrites, in the [load balancer section of the capacity simulator write-up](/en/projects/tools/capacity-sim/#load-balancer).

## HTTP: the part your code actually sees

With a reliable, encrypted byte stream in hand, HTTP is almost anticlimactic: it's a text format for asking for things and getting answers. The interesting part is how the format has changed across three major versions, and why.

### HTTP/1.1: text, and one thing at a time

This is what travels inside the TLS records for our example request. You can type it by hand into `openssl s_client` and it works.

```http
GET /orders HTTP/1.1
Host: api.example.com
User-Agent: curl/8.5.0
Accept: application/json

```

A request line, then headers one per line, then a blank line. The blank line is the framing: the parser reads until `\r\n\r\n` and knows the headers are over. If the request has a body (a `POST`), `Content-Length` says how many bytes follow. The response has the same shape:

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 23

{"orders": [{"id": 1}]}
```

When the server doesn't know the length in advance (it's streaming a generated response), it uses `Transfer-Encoding: chunked` instead: each chunk is prefixed with its size in hex, and a zero-size chunk marks the end. Either way, the receiver can tell where the message ends without the connection closing, which is what lets the connection be **reused** for the next request. HTTP/1.1 made that the default (`Connection: keep-alive`), and it's the single biggest thing you can do for latency: every request after the first skips both handshakes and starts with a warmed-up congestion window.

The limitation that eventually forced a redesign: on an HTTP/1.1 connection, requests are strictly serialised. You send one, you wait for its complete response, then you send the next. If one response is slow, everything queued behind it waits; this is **head-of-line blocking** at the HTTP level. Browsers work around it by opening about six connections per hostname and spreading requests across them, which is why old performance advice included serving assets from several domains. (An attempt to send several requests back to back on one connection, *pipelining*, was in the spec but broke too many proxies and was abandoned.)

### HTTP/2: frames and streams

HTTP/2 keeps the semantics (same methods, status codes, headers) and replaces the wire format. Instead of text, everything is **binary frames**, each with a length, a type, and a **stream ID**. A stream is one request/response pair; a connection carries many streams at once, with their frames interleaved. Request 3's response can start arriving while request 1's is still streaming. One connection per origin does everything, and the six-connection trick goes away.

Headers are compressed with **HPACK**, which keeps a table of previously sent headers on both sides, so the second request that sends the same 800-byte cookie sends a one-byte reference instead. Browsers only speak HTTP/2 over TLS, and the version is chosen by ALPN during the TLS handshake, so there is no upgrade round trip.

But look again at the reliability section. All those streams share one TCP connection, and TCP delivers bytes in order. If one packet is lost, the bytes behind it in the stream are stuck in the receive buffer until the retransmission arrives, *even if they belong to other streams that lost nothing*. HTTP/2 removed head-of-line blocking from HTTP and exposed it in TCP. On a clean wired network it hardly matters; on a lossy mobile connection, one HTTP/2 connection can be slower than six HTTP/1.1 ones.

### HTTP/3 and QUIC: leaving TCP behind

The fix was not to patch TCP, which can't be changed without updating every kernel and middlebox on earth, but to replace it.

<div data-diagram="net-http-versions"></div>

**QUIC** is a new transport that runs on top of UDP and reimplements what TCP does, with three changes that matter:

- **Streams are a transport concept.** QUIC itself knows about streams, and reliability is per stream. A lost packet stalls only the stream whose data it carried; other streams keep delivering. This is the head-of-line fix HTTP/2 couldn't have.
- **TLS 1.3 is built in**, not layered on top. The QUIC handshake *is* the TLS handshake, and the transport parameters ride inside it. A new connection costs one round trip, and a resumed one can carry the request in the first packet (the same 0-RTT, with the same replay caveat). Almost everything, including most of the packet headers, is encrypted, which also means middleboxes can't "helpfully" interfere with it the way they did with TCP.
- **Connections are identified by a connection ID, not the four-tuple.** When your phone moves from Wi-Fi to cellular and its IP address changes, a TCP connection is dead; a QUIC connection carries on, because the server recognises the ID in the next packet.

**HTTP/3** is HTTP/2's semantics mapped onto QUIC streams, with a header compression scheme (QPACK) that tolerates out-of-order delivery. A browser discovers that a server supports it either from an `Alt-Svc` header on an earlier HTTP/2 response or from the `HTTPS` DNS record, then switches. Most CDNs and the big sites serve it; most self-hosted app servers don't yet, so in practice your users talk HTTP/3 to the edge and the edge talks HTTP/2 or 1.1 to you.

The cost of doing all this in user space is CPU: a QUIC stack can't use the kernel's optimised TCP path or the network card's offloads, so it burns more cycles per byte. For a CDN that's a price worth paying for the latency; for a bulk file server it may not be.

## Counting round trips

Putting the layers together, here is what it costs to get the first byte of a response, measured in round trips, for the different ways a connection can be set up.

<div data-diagram="net-first-byte"></div>

The counting: TCP's handshake is one round trip (the client's ACK rides with the first TLS message, so it's not a separate trip). TLS 1.3 is one more, and the HTTP request rides with the client's Finished. The request and the first byte of response are one more. Three in total for a fresh HTTPS connection with TLS 1.3; four with TLS 1.2; two with QUIC, whose handshake is the TLS handshake.

What this means in milliseconds depends entirely on distance. To a server in the same city, a round trip is 5–10 ms and three of them are invisible. To a server on another continent, 150 ms each, a fresh TLS 1.2 connection spends 450 ms doing nothing useful before the request even leaves. Transatlantic latency is physics; you can't fix it, you can only avoid paying it repeatedly. In order of impact:

1. **Reuse connections.** Every HTTP client library has a connection pool; use one client object for the life of your process rather than creating one per request. (In Python, that's `requests.Session()` or an `httpx.Client()` instead of bare `requests.get()`. Creating a client per call throws away both handshakes and the warmed-up congestion window every time.) The same applies to database connections, which pay the same handshakes.
2. **Use HTTP/2 or HTTP/3**, so one connection does the work of many and the reuse rate goes up.
3. **Use TLS 1.3**, and allow resumption. This is mostly a matter of not running ten-year-old server software.
4. **Terminate close to the user.** A CDN edge in the user's city does the handshakes over a 5 ms round trip and keeps long-lived, warmed-up connections to your origin. This is a bigger win than any protocol tweak: it turns three expensive round trips into three cheap ones plus one that was already paid.
5. **Hint the browser.** `<link rel="preconnect">` tells it to do DNS, TCP and TLS for a host *now*, in the background, before the first request to that host is discovered.

## The server side: where each layer ends

On the server, the request goes back up the stack, and it helps to see exactly which piece of software consumes each layer, because "the server" is at least four different programs.

<div data-diagram="net-server-path"></div>

The network card receives frames and hands packets to the kernel. The kernel's IP code checks the destination is this machine; its TCP code finds the socket by four-tuple, checks sequence numbers, sends ACKs, reassembles the byte stream, and puts bytes in the socket's receive buffer. That is where the kernel's involvement ends.

The process that called `accept()` reads from that socket. If TLS terminates here, the first thing the bytes hit is the TLS library, which parses records, decrypts them, and produces plaintext. Then an HTTP parser (in uvicorn, in Node's `http` module, in Go's `net/http`, in nginx) reads the request line and headers, works out the body length, and builds a request object. Only then does your framework look at the path, pick a route, and call your function with that object.

So by the time `def get_orders(request)` runs, five layers of headers have been read and discarded. Your function sees none of them. If you want the client's IP, the framework got it from the socket (`getpeername()`), which is the *last hop's* address, which is the load balancer's if there is one; hence `X-Forwarded-For`.

## See it for yourself

Reading about this is one thing; watching it happen fixed it in my head. These are the commands I used.

**Watch a connection being set up** with `curl -v`. The lines marked `*` are curl narrating each layer; the `>` and `<` lines are the HTTP request and response.

```text
$ curl -v https://api.example.com/orders
* Host api.example.com:443 was resolved.                 ← DNS
* IPv6: 2606:2800:21f:cb07:6820:80da:af6b:8b2c
* IPv4: 93.184.216.34
*   Trying [2606:2800:21f:cb07:6820:80da:af6b:8b2c]:443...   ← Happy Eyeballs, IPv6 first
* Connected to api.example.com (2606:2800:...) port 443   ← TCP handshake done
* ALPN: curl offers h2,http/1.1
* TLSv1.3 (OUT), TLS handshake, Client hello (1):         ← the one round trip
* TLSv1.3 (IN), TLS handshake, Server hello (2):
* TLSv1.3 (IN), TLS handshake, Encrypted Extensions (8):
* TLSv1.3 (IN), TLS handshake, Certificate (11):
* TLSv1.3 (IN), TLS handshake, CERT verify (15):
* TLSv1.3 (IN), TLS handshake, Finished (20):
* TLSv1.3 (OUT), TLS handshake, Finished (20):
* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384
* ALPN: server accepted h2                                ← HTTP/2 chosen
* Server certificate:
*  subject: CN=api.example.com
*  issuer: C=US; O=Let's Encrypt; CN=R11                  ← the intermediate
*  SSL certificate verify ok.
* using HTTP/2
> GET /orders HTTP/2                                      ← finally, HTTP
> Host: api.example.com
```

**See the TCP states** on your machine with `ss` (the modern `netstat`). `ss -tan` lists every TCP socket with its state and four-tuple; after a burst of requests you'll see `ESTABLISHED` ones for reused connections and a pile of `TIME-WAIT`. `ss -tin` adds TCP internals per connection, including the measured `rtt`, the current `cwnd`, and the congestion algorithm in use.

```text
$ ss -tin dst :443
ESTAB  0  0  192.168.1.23:51234  93.184.216.34:443
     cubic wscale:7,7 rto:284 rtt:82.4/3.1 mss:1460 cwnd:10 bytes_sent:1821 ...
```

**Capture the packets** with `tcpdump -i any -n port 443` and you'll see the handshake in its native form: `[S]`, `[S.]`, `[.]`, then the TLS records as plain `length` lines, then `[F.]` at the end. To see inside the TLS, point Wireshark at a capture and set the `SSLKEYLOGFILE` environment variable before starting your browser or `curl`; they'll write the session keys to that file, and Wireshark will decrypt the HTTP for you. It is the single most educational hour you can spend on this topic.

**Inspect a certificate chain** with `openssl s_client -connect api.example.com:443 -servername api.example.com`. The `-servername` sets the SNI; leave it off and a server hosting several sites will hand you the wrong certificate, which is a good way to see why SNI exists. Once it's connected you can type the HTTP/1.1 request from the section above by hand, blank line and all, and read the response.

## Questions I had, answered

Short answers to the things I kept asking, collected in one place.

**What is a socket, really?** A kernel object that your process holds through a file descriptor. A *listening* socket is identified by a local IP and port and does nothing but accept handshakes. Each *connected* socket is identified by a full four-tuple and owns a send buffer, a receive buffer, the sequence numbers, the windows and the state machine. `accept()` on a listening socket gives you a new connected socket for each client.

**One port 443, thousands of clients: how?** Incoming packets are matched by the whole four-tuple, not the destination port. Each client's packets have a different source IP and port, so they land in different sockets. The limit on connections is memory and file descriptors, not ports.

**Is a connection the same as a request?** No, and conflating them is the most common misunderstanding I see. A connection is a TCP (and TLS) session that costs round trips to set up. A request is an HTTP message that travels over one. A connection can carry thousands of requests over its life, and with HTTP/2 many at the same time. Fast systems create few connections and many requests.

**Why does the first request to a server take so much longer than the rest?** The first one pays for DNS, the TCP handshake, the TLS handshake, and slow start. The rest reuse all of it. If *every* request in your service is slow, check whether something is creating a new client per call.

**Why does my app see the load balancer's IP?** Because a layer 7 load balancer is a full TCP+TLS+HTTP endpoint that ends the client's connection and opens a new one of its own. At layer 3, the connection to your app genuinely comes from the load balancer. The client's address only survives as an HTTP header, `X-Forwarded-For`, which the load balancer adds and your app has to trust (and which anyone can forge if your app is also reachable directly, so bind it to the private network).

**Why does HTTPS not hide the hostname?** The server needs the hostname to pick a certificate before it can encrypt anything, so the ClientHello carries it in the clear (SNI). Encrypted Client Hello fixes this where it's deployed. The path, query, headers and body are all encrypted.

**What does "connection reset by peer" mean?** The other side sent a RST: it had no socket for this four-tuple, or it gave up on it. Usual causes: the process crashed or restarted, a load balancer or NAT dropped an idle connection's state and then saw a packet for it, or you connected to a port with nothing listening.

**Refused vs timed out?** *Refused* is a RST in reply to your SYN: the host is up and nothing is listening on that port. *Timed out* is silence: a firewall dropped the SYN, the route is broken, or the host is down. Refused comes back in one round trip; timeouts take as long as you configured.

**Why is MTU 1500 and what happens to a bigger packet?** 1500 is Ethernet's historical maximum frame payload, and the internet inherited it. TCP avoids the problem by never building a segment bigger than the MSS. A path with a smaller MTU somewhere (a VPN or tunnel adds headers) either fragments packets at the IP layer, which is slow and often blocked, or signals the sender to shrink them (*path MTU discovery*); mysterious hangs on large responses over a VPN are usually this, and the fix is clamping the MSS lower.

**Why do I see so many TIME_WAIT sockets?** Each one is a connection *you* closed first, held for 60 seconds so stray packets can't corrupt a new connection on the same four-tuple. Thousands of them means something is opening and closing a connection per request. Reuse connections, or arrange for the client to close.

**Where do WebSockets fit?** A WebSocket starts as an ordinary HTTP/1.1 request with `Upgrade: websocket`. After the server's `101 Switching Protocols`, HTTP is finished and the same TCP+TLS connection carries WebSocket frames (which have their own tiny length-prefixed framing) in both directions for as long as it stays open. The expensive setup is identical to any HTTPS request; the saving is that it happens once.

**Does any of this change with gRPC?** gRPC is HTTP/2 with a fixed binary body format, so everything above applies directly. Its reliance on long-lived HTTP/2 connections is also why it runs into the "one connection, one backend" problem behind layer 4 load balancers, which can only balance connections, not the requests inside them.

## Further reading

- [RFC 9293](https://www.rfc-editor.org/rfc/rfc9293), the current TCP specification, which consolidated forty years of updates into one readable document.
- [RFC 8446](https://www.rfc-editor.org/rfc/rfc8446), TLS 1.3. Section 2 is a short, clear overview of the handshake.
- [RFC 9000](https://www.rfc-editor.org/rfc/rfc9000), QUIC, and [RFC 9114](https://www.rfc-editor.org/rfc/rfc9114), HTTP/3.
- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110), HTTP semantics, with [9112](https://www.rfc-editor.org/rfc/rfc9112) for HTTP/1.1 and [9113](https://www.rfc-editor.org/rfc/rfc9113) for HTTP/2.
- *High Performance Browser Networking* by Ilya Grigorik, free to read online. Older now, but the chapters on TCP, TLS and the round-trip budget are the best explanations I've found.
- *Beej's Guide to Network Programming*, for the socket API from the C side, where it's easiest to see what the kernel actually offers.
- [The Illustrated TLS 1.3 Connection](https://tls13.xargs.org/), every byte of a real handshake, annotated.
