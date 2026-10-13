/**
 * Diagrams for the "How an HTTPS request really works" blog post.
 * Each export is { labels: { en, ja }, render(labels) -> { svg, caption } }.
 *
 * Several of these are sequence diagrams: two lifelines (client on the left,
 * server on the right) with messages drawn as slightly sloped arrows, so time
 * reads top to bottom and the slope stands for the trip across the network.
 */
import { box, card, line, marker, svg, text } from './svg.mjs';

const W = 820;

/* ---------- Sequence-diagram helpers ---------- */

const SEQ = { l: 220, r: 660, headW: 150 };
/** How far a message drops while crossing: enough to read as travel, not enough to collide with its labels */
const SLOPE = 18;

/** Header boxes and dashed lifelines for a client/server sequence diagram */
function actors(l, r, H, { lSub, rSub, headW = SEQ.headW } = {}) {
  return [
    box(SEQ.l - headW / 2, 14, headW, lSub ? 48 : 36, { title: l, sub: lSub }),
    box(SEQ.r - headW / 2, 14, headW, rSub ? 48 : 36, { title: r, sub: rSub }),
    line(SEQ.l, lSub ? 62 : 50, SEQ.l, H - 8, { end: false, dashed: true }),
    line(SEQ.r, rSub ? 62 : 50, SEQ.r, H - 8, { end: false, dashed: true }),
  ].join('');
}

/**
 * One message. `from` is 'l' or 'r'; it leaves at y0 and arrives SLOPE lower.
 * `label` sits above the midpoint; `sub` (muted) below it.
 */
function msg(from, y0, label, m, { cls = '', sub, dashed = false } = {}) {
  const y1 = y0 + SLOPE;
  const x0 = from === 'l' ? SEQ.l : SEQ.r;
  const x1 = from === 'l' ? SEQ.r : SEQ.l;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const labelCls = cls === 'primary' ? 'd-primary-text' : cls === 'secondary' ? 'd-secondary-text' : cls === 'pink' ? 'd-pink' : 'd-text';
  const parts = [line(x0, y0, x1, y1, { cls, markerId: m, dashed })];
  if (label) parts.push(text(mx, my - 7, label, labelCls, 'text-anchor="middle"'));
  if (sub) parts.push(text(mx, my + 18, sub, 'd-muted', 'text-anchor="middle"'));
  return parts.join('');
}

/** A note beside a lifeline: outside the client line on the left, outside the server line on the right */
function note(side, y, t, cls = 'd-muted') {
  return side === 'l'
    ? text(SEQ.l - 14, y, t, cls, 'text-anchor="end"')
    : text(SEQ.r + 14, y, t, cls);
}

/** A vertical bracket at the far left spanning y0..y1, with a label beside it */
function bracket(y0, y1, lines, x = 100) {
  const parts = [
    line(x, y0, x, y1, { end: false, cls: 'secondary' }),
    line(x, y0, x + 6, y0, { end: false, cls: 'secondary' }),
    line(x, y1, x + 6, y1, { end: false, cls: 'secondary' }),
  ];
  const ls = Array.isArray(lines) ? lines : [lines];
  const cy = (y0 + y1) / 2 + 4 - ((ls.length - 1) * 14) / 2;
  ls.forEach((t, i) => parts.push(text(x - 8, cy + i * 14, t, i === 0 ? 'd-secondary-text' : 'd-muted', 'text-anchor="end"')));
  return parts.join('');
}

/** A translucent band between the lifelines (used for "encrypted from here") */
function shade(y0, y1, label) {
  const parts = [`<rect x="${SEQ.l + 1}" y="${y0}" width="${SEQ.r - SEQ.l - 2}" height="${y1 - y0}" class="d-shade" />`];
  if (label) parts.push(text(SEQ.r - 8, y0 + 14, label, 'd-primary-text', 'text-anchor="end"'));
  return parts.join('');
}

/* ---------- 1. Where each layer lives ---------- */

export const netStackOwnership = {
  labels: {
    en: {
      aria: 'Which part of a computer handles each network layer: the application handles HTTP and TLS, the kernel handles TCP, IP and Ethernet, the network card handles the wire',
      bands: ['User space · your process', 'Kernel', 'Hardware'],
      rows: [
        ['HTTP', 'Your framework and its server (uvicorn, Express, nginx…)', 'parses request lines, headers and bodies out of plain bytes'],
        ['TLS', 'A library linked into the process (OpenSSL, BoringSSL, rustls…)', 'encrypts and decrypts; the app only ever sees plaintext'],
        ['TCP', 'The kernel’s TCP stack', 'handshakes, sequence numbers, retransmission, windows'],
        ['IP', 'The kernel’s routing code', 'picks the source address and the next hop'],
        ['Ethernet', 'The driver', 'frames, MAC addresses, ARP'],
        ['Wire', 'The network card', 'bits on copper, fibre or radio'],
      ],
      socket: 'socket API: connect(), send(), recv()  ·  the app sees a byte stream, never a packet',
      caption:
        'Nothing in your code ever touches a packet. The application hands bytes to the kernel through a socket and gets bytes back; everything below that line is the operating system’s job.',
    },
    ja: {
      aria: 'ネットワークの各層をコンピューターのどこが担当するか：アプリケーションがHTTPとTLS、カーネルがTCP・IP・Ethernet、ネットワークカードが物理層',
      bands: ['ユーザー空間 · 自分のプロセス', 'カーネル', 'ハードウェア'],
      rows: [
        ['HTTP', 'フレームワークとそのサーバー（uvicorn、Express、nginx…）', 'ただのバイト列からリクエスト行・ヘッダー・ボディを読み取る'],
        ['TLS', 'プロセスにリンクされたライブラリ（OpenSSL、BoringSSL、rustls…）', '暗号化と復号。アプリは平文しか見ない'],
        ['TCP', 'カーネルのTCPスタック', 'ハンドシェイク、シーケンス番号、再送、ウィンドウ'],
        ['IP', 'カーネルのルーティング処理', '送信元アドレスと次のホップを決める'],
        ['Ethernet', 'ドライバー', 'フレーム、MACアドレス、ARP'],
        ['物理層', 'ネットワークカード', '銅線・光ファイバー・電波上のビット'],
      ],
      socket: 'ソケットAPI：connect()、send()、recv()  ·  アプリに見えるのはバイト列だけで、パケットは見えない',
      caption:
        '自分のコードがパケットに触れることは一度もありません。アプリケーションはソケットを通してカーネルにバイト列を渡し、バイト列を受け取るだけです。その線より下はすべてOSの仕事です。',
    },
  },
  render(l) {
    const parts = [];
    const rowH = 44;
    const bandRows = [2, 3, 1];
    const bandGap = 26;
    let y = 16;
    let r = 0;
    bandRows.forEach((n, bi) => {
      const h = 30 + n * rowH;
      parts.push(`<rect x="20" y="${y}" width="${W - 40}" height="${h}" rx="10" class="d-band" />`);
      parts.push(text(34, y + 19, l.bands[bi], 'd-band-label'));
      for (let i = 0; i < n; i++) {
        const ry = y + 30 + i * rowH;
        const row = l.rows[r++];
        parts.push(box(34, ry, 110, 34, { title: row[0] }));
        parts.push(text(160, ry + 15, row[1], 'd-text'));
        parts.push(text(160, ry + 30, row[2], 'd-muted'));
      }
      if (bi === 0) {
        const sy = y + h + bandGap / 2;
        parts.push(line(20, sy, W - 20, sy, { end: false, dashed: true, cls: 'primary' }));
        parts.push(`<rect x="${W / 2 - 300}" y="${sy - 9}" width="600" height="18" rx="4" class="d-label-bg" />`);
        parts.push(text(W / 2, sy + 4, l.socket, 'd-primary-text', 'text-anchor="middle"'));
      }
      y += h + bandGap;
    });
    return { svg: svg(W, y - bandGap + 10, parts.join(''), { label: l.aria }), caption: l.caption };
  },
};

/* ---------- 2. Who fills in each address ---------- */

export const netFourTuple = {
  labels: {
    en: {
      aria: 'The five addresses on the first packet of a connection, who decides each one and how',
      head: ['Field', 'Example', 'Decided by', 'How'],
      rows: [
        ['Destination IP', '93.184.216.34', ['app', 'the application'], 'DNS lookup of the hostname in the URL'],
        ['Destination port', '443', ['app', 'the application'], 'explicit :port in the URL, else the scheme’s default'],
        ['Source IP', '192.168.1.23', ['os', 'the OS'], 'routing table: whichever interface reaches it'],
        ['Source port', '51234', ['os', 'the OS'], 'a random ephemeral port (32768–60999 on Linux)'],
        ['Next-hop MAC', 'a4:83:e7:…', ['net', 'the OS, every hop'], 'ARP for the gateway; every router swaps it'],
      ],
      legend: [['app', 'chosen by your code, passed to connect()'], ['os', 'filled in by the kernel'], ['net', 'changes at every hop']],
      caption:
        'connect() takes two values, and the kernel supplies the rest. The four highlighted fields together identify the connection on both machines; the MAC is only ever about the next cable.',
    },
    ja: {
      aria: '接続の最初のパケットに載る5つのアドレスと、それぞれを誰がどう決めるか',
      head: ['フィールド', '例', '決める側', '方法'],
      rows: [
        ['宛先IP', '93.184.216.34', ['app', 'アプリケーション'], 'URLのホスト名をDNSで引く'],
        ['宛先ポート', '443', ['app', 'アプリケーション'], 'URLの明示の:port、なければスキームの既定値'],
        ['送信元IP', '192.168.1.23', ['os', 'OS'], 'ルーティングテーブル：宛先に届くインターフェース'],
        ['送信元ポート', '51234', ['os', 'OS'], 'ランダムなエフェメラルポート（Linux: 32768〜60999）'],
        ['次ホップMAC', 'a4:83:e7:…', ['net', 'OS、ホップごと'], 'ゲートウェイをARPで引く。ルーターが毎回付け替える'],
      ],
      legend: [['app', '自分のコードが選び、connect()に渡す'], ['os', 'カーネルが埋める'], ['net', 'ホップごとに変わる']],
      caption:
        'connect()に渡すのは2つの値だけで、残りはカーネルが補います。強調した4つのフィールドの組が両方のマシンで接続を識別し、MACは次のケーブルのことしか表しません。',
    },
  },
  render(l) {
    const cols = [20, 150, 282, 420];
    const rowH = 34;
    const top = 44;
    const parts = [];
    l.head.forEach((h, i) => parts.push(text(cols[i] + 10, 26, h, 'd-th')));
    parts.push(line(20, 34, W - 20, 34, { end: false }));
    l.rows.forEach((row, ri) => {
      const y = top + ri * rowH;
      const cls = row[2][0];
      parts.push(`<rect x="20" y="${y}" width="${W - 40}" height="${rowH - 4}" rx="6" class="d-cell d-row-${cls}" />`);
      parts.push(text(cols[0] + 10, y + 19, row[0], 'd-title'));
      parts.push(text(cols[1] + 10, y + 19, row[1], 'd-text'));
      parts.push(text(cols[2] + 10, y + 19, row[2][1], `d-who-${cls}`));
      parts.push(text(cols[3] + 10, y + 19, row[3], 'd-muted'));
    });
    let lx = 20;
    const ly = top + l.rows.length * rowH + 16;
    l.legend.forEach(([state, label]) => {
      parts.push(
        `<rect x="${lx}" y="${ly - 10}" width="14" height="14" rx="3" class="d-cell d-row-${state} d-legend" />`,
        text(lx + 20, ly + 1, label, 'd-muted'),
      );
      lx += 24 + label.length * (/[^\x00-\x7f]/.test(label) ? 11.5 : 6.8) + 22;
    });
    return { svg: svg(W, ly + 16, parts.join(''), { label: l.aria }), caption: l.caption };
  },
};

/* ---------- 3. The TCP three-way handshake ---------- */

export const netTcpHandshake = {
  labels: {
    en: {
      aria: 'TCP three-way handshake: SYN, SYN-ACK, ACK, with sequence numbers and the state each side is in',
      client: 'Client',
      server: 'Server',
      syn: 'SYN  seq = x',
      synSub: '“I want to talk, my numbering starts at x”',
      synack: 'SYN-ACK  seq = y, ack = x + 1',
      synackSub: '“Heard you. Mine starts at y”',
      ack: 'ACK  ack = y + 1',
      ackSub: 'with TLS 1.3 the ClientHello rides in the same packet',
      states: { closed: 'CLOSED', listen: 'LISTEN', synSent: 'SYN_SENT', synRcvd: 'SYN_RECEIVED', est: 'ESTABLISHED' },
      rtt: ['1 RTT', 'before any', 'data can go'],
      caption:
        'Each side picks a random starting sequence number and the other side acknowledges it, which is why three messages are the minimum. The client can send data as soon as its ACK leaves; the server waits until it arrives.',
    },
    ja: {
      aria: 'TCPの3ウェイハンドシェイク：SYN、SYN-ACK、ACKと、シーケンス番号、それぞれの側の状態',
      client: 'クライアント',
      server: 'サーバー',
      syn: 'SYN  seq = x',
      synSub: '「話したい。こちらの番号はxから」',
      synack: 'SYN-ACK  seq = y, ack = x + 1',
      synackSub: '「了解。こちらはyから」',
      ack: 'ACK  ack = y + 1',
      ackSub: 'TLS 1.3ならClientHelloが同じパケットに相乗りする',
      states: { closed: 'CLOSED', listen: 'LISTEN', synSent: 'SYN_SENT', synRcvd: 'SYN_RECEIVED', est: 'ESTABLISHED' },
      rtt: ['1 RTT', 'データを送る', '前に必要'],
      caption:
        '双方がランダムな開始シーケンス番号を選び、相手がそれを確認するので、最低3つのメッセージが必要です。クライアントはACKを送った瞬間からデータを送れますが、サーバーはそれが届くまで待ちます。',
    },
  },
  render(l) {
    const id = 'net-hs';
    const m = `${id}-a`;
    const H = 270;
    const parts = [actors(l.client, l.server, H)];
    parts.push(note('l', 70, l.states.closed), note('r', 70, l.states.listen));
    parts.push(msg('l', 84, l.syn, m, { cls: 'primary', sub: l.synSub }));
    parts.push(note('l', 96, l.states.synSent, 'd-primary-text'));
    parts.push(note('r', 114, l.states.synRcvd, 'd-secondary-text'));
    parts.push(msg('r', 140, l.synack, `${id}-s`, { cls: 'secondary', sub: l.synackSub }));
    parts.push(note('l', 174, l.states.est, 'd-primary-text'));
    parts.push(msg('l', 196, l.ack, m, { cls: 'primary', sub: l.ackSub }));
    parts.push(note('r', 230, l.states.est, 'd-secondary-text'));
    parts.push(bracket(84, 196, l.rtt));
    return {
      svg: svg(W, H, parts.join(''), { label: l.aria, defs: marker(m, 'primary') + marker(`${id}-s`, 'secondary') }),
      caption: l.caption,
    };
  },
};

/* ---------- 4. Packets vs the byte stream ---------- */

export const netByteStream = {
  labels: {
    en: {
      aria: 'One send of 4000 bytes becomes three TCP segments of 1460, 1460 and 1080 bytes, arrives out of order, and is read back as two receives of 2000 bytes',
      send: 'send() · 4000 bytes',
      sendNote: 'one call from your code',
      segs: 'TCP segments on the wire',
      segNote: 'MSS 1460 = 1500 MTU − 20 IP − 20 TCP',
      arrive: 'arrival order at the receiver',
      arriveNote: 'the second one took a different route',
      buffer: 'receive buffer',
      bufferNote: 'reassembled by sequence number',
      recv: ['recv() → 2000 bytes', 'recv() → 2000 bytes'],
      recvNote: 'your code reads whatever has arrived; boundaries are gone',
      caption:
        'TCP numbers every byte, not every packet. That is what lets the receiver put segments back in order, and it is also why a single send() can come out of recv() in any number of pieces: the stream has no boundaries to preserve.',
    },
    ja: {
      aria: '4000バイトのsend()が1460、1460、1080バイトの3つのTCPセグメントになり、順不同で届き、2000バイトずつ2回のrecv()で読み出される',
      send: 'send() · 4000バイト',
      sendNote: '自分のコードからの1回の呼び出し',
      segs: '回線上のTCPセグメント',
      segNote: 'MSS 1460 = MTU 1500 − IP 20 − TCP 20',
      arrive: '受信側での到着順',
      arriveNote: '2つ目は別の経路を通った',
      buffer: '受信バッファ',
      bufferNote: 'シーケンス番号で並べ直す',
      recv: ['recv() → 2000バイト', 'recv() → 2000バイト'],
      recvNote: '自分のコードは届いた分を読むだけ。境界は残らない',
      caption:
        'TCPはパケットではなく1バイトごとに番号を振ります。だから受信側はセグメントを並べ直せますし、1回のsend()がrecv()では何個にでも分かれて出てくるのもそのためです。ストリームには守るべき境界がありません。',
    },
  },
  render(l) {
    const x0 = 300;
    const scale = 500 / 4000; // px per byte
    const h = 26;
    const segs = [
      { from: 0, to: 1460, cls: 'a' },
      { from: 1460, to: 2920, cls: 'b' },
      { from: 2920, to: 4000, cls: 'c' },
    ];
    const strip = (x, y, w, cls, label) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" class="d-strip d-strip-${cls}" />` +
      text(x + w / 2, y + 17, label, 'd-strip-text', 'text-anchor="middle"');
    const parts = [];
    const rowLabel = (y, t, sub) => text(x0 - 16, y + 17, t, 'd-title', 'text-anchor="end"') + (sub ? text(x0 - 16, y + 33, sub, 'd-muted', 'text-anchor="end"') : '');
    // Row 1: the send
    let y = 20;
    parts.push(rowLabel(y, l.send, l.sendNote));
    parts.push(`<rect x="${x0}" y="${y}" width="${4000 * scale}" height="${h}" rx="4" class="d-strip d-strip-all" />`);
    parts.push(text(x0 + (4000 * scale) / 2, y + 17, '0 … 3999', 'd-strip-text', 'text-anchor="middle"'));
    // Row 2: segments, same positions, split
    y = 90;
    parts.push(rowLabel(y, l.segs, l.segNote));
    segs.forEach((s) => parts.push(strip(x0 + s.from * scale + 2, y, (s.to - s.from) * scale - 4, s.cls, `seq ${s.from}–${s.to - 1}`)));
    segs.forEach((s) => parts.push(line(x0 + ((s.from + s.to) / 2) * scale, 20 + h + 4, x0 + ((s.from + s.to) / 2) * scale, y - 4, { end: false, dashed: true })));
    // Row 3: arrival order (2nd before 1st)
    y = 160;
    parts.push(rowLabel(y, l.arrive, l.arriveNote));
    const order = [segs[1], segs[0], segs[2]];
    let ax = x0;
    order.forEach((s) => {
      const w = (s.to - s.from) * scale - 4;
      parts.push(strip(ax + 2, y, w, s.cls, `seq ${s.from}–${s.to - 1}`));
      ax += w + 4;
    });
    // Row 4: reassembled buffer
    y = 230;
    parts.push(rowLabel(y, l.buffer, l.bufferNote));
    segs.forEach((s) => parts.push(strip(x0 + s.from * scale + 2, y, (s.to - s.from) * scale - 4, s.cls, `${s.from}–${s.to - 1}`)));
    // recv brackets under the buffer, cutting across segment boundaries
    const by = y + h + 10;
    [
      [0, 2000],
      [2000, 4000],
    ].forEach(([a, b], i) => {
      const bx0 = x0 + a * scale + 2;
      const bx1 = x0 + b * scale - 2;
      parts.push(
        line(bx0, by, bx0, by + 8, { end: false, cls: 'primary' }),
        line(bx0, by + 8, bx1, by + 8, { end: false, cls: 'primary' }),
        line(bx1, by, bx1, by + 8, { end: false, cls: 'primary' }),
        text((bx0 + bx1) / 2, by + 24, l.recv[i], 'd-primary-text', 'text-anchor="middle"'),
      );
    });
    parts.push(text(x0 + (4000 * scale) / 2, by + 42, l.recvNote, 'd-muted', 'text-anchor="middle"'));
    return { svg: svg(W, by + 56, parts.join(''), { label: l.aria }), caption: l.caption };
  },
};

/* ---------- 5. Loss and recovery ---------- */

export const netTcpRetransmit = {
  labels: {
    en: {
      aria: 'Four TCP segments are sent, the second is lost, the receiver repeats the same ACK three times and the sender retransmits the missing segment without waiting for a timeout',
      client: 'Sender',
      server: 'Receiver',
      seg: (n) => `seg ${n}`,
      lost: 'lost',
      acks: ['ACK 1461', 'ACK 1461 (dup)', 'ACK 1461 (dup)', 'ACK 1461 (dup)'],
      ackNote: '“still need 1461”',
      resend: 'seg 2 again',
      final: 'ACK 5841',
      finalNote: 'one ACK covers everything up to here',
      fast: ['3 dup ACKs', 'fast', 'retransmit'],
      caption:
        'ACKs are cumulative: “1461” means “I have every byte before 1461”. Three identical ACKs tell the sender exactly which segment to resend, long before its retransmission timer would have fired.',
    },
    ja: {
      aria: 'TCPセグメントを4つ送り、2つ目が失われ、受信側が同じACKを3回繰り返し、送信側がタイムアウトを待たずに欠けたセグメントを再送する',
      client: '送信側',
      server: '受信側',
      seg: (n) => `seg ${n}`,
      lost: '消失',
      acks: ['ACK 1461', 'ACK 1461（重複）', 'ACK 1461（重複）', 'ACK 1461（重複）'],
      ackNote: '「1461バイト目がまだ」',
      resend: 'seg 2 を再送',
      final: 'ACK 5841',
      finalNote: 'ここまでの全部を1つのACKで確認',
      fast: ['重複ACK 3回', '高速', '再送'],
      caption:
        'ACKは累積です。「1461」は「1461より前のバイトは全部持っている」という意味です。同じACKが3回届けば、送信側は再送タイマーが切れるずっと前に、どのセグメントを送り直せばいいか正確に分かります。',
    },
  },
  render(l) {
    const id = 'net-rtx';
    const mp = `${id}-p`;
    const ms = `${id}-s`;
    const H = 356;
    const parts = [actors(l.client, l.server, H)];
    const gap = 34;
    const segY = (i) => 70 + i * gap;
    // Four segments leave back to back; each is named beside the sender's lifeline
    for (let i = 0; i < 4; i++) {
      const y0 = segY(i);
      parts.push(note('l', y0 + 4, l.seg(i + 1), 'd-primary-text'));
      if (i === 1) {
        // Lost: the arrow stops two thirds of the way and gets a cross
        const xEnd = SEQ.l + (SEQ.r - SEQ.l) * 0.62;
        const yEnd = y0 + SLOPE * 0.62;
        parts.push(line(SEQ.l, y0, xEnd, yEnd, { cls: 'primary', end: false }));
        parts.push(`<path d="M${xEnd - 6} ${yEnd - 6} l12 12 M${xEnd + 6} ${yEnd - 6} l-12 12" class="d-x" />`);
        parts.push(text(xEnd + 14, yEnd + 4, `${l.seg(2)} · ${l.lost}`, 'd-pink'));
      } else {
        parts.push(msg('l', y0, '', mp, { cls: 'primary' }));
      }
    }
    // ACKs come back for segments 1, 3 and 4; the last two repeat the first
    const ackFor = [0, 2, 3];
    let lastAckLeaves = 0;
    ackFor.forEach((i, k) => {
      const y0 = segY(i) + SLOPE + 2;
      lastAckLeaves = y0;
      parts.push(msg('r', y0, '', ms, { cls: 'secondary' }));
      parts.push(note('r', y0 + 4, l.acks[k], 'd-secondary-text'));
    });
    parts.push(note('r', lastAckLeaves + 20, l.ackNote));
    // Fast retransmit, as soon as the third duplicate arrives
    const ry = lastAckLeaves + SLOPE + 16;
    parts.push(msg('l', ry, l.resend, mp, { cls: 'pink' }));
    parts.push(bracket(segY(0) + SLOPE * 2 + 2, ry, l.fast));
    parts.push(msg('r', ry + SLOPE + 4, l.final, ms, { cls: 'secondary', sub: l.finalNote }));
    return {
      svg: svg(W, H, parts.join(''), { label: l.aria, defs: marker(mp, 'primary') + marker(ms, 'secondary') }),
      caption: l.caption,
    };
  },
};

/* ---------- 6. Flow control and congestion control ---------- */

export const netWindows = {
  labels: {
    en: {
      aria: 'The sender’s view of the byte stream: acknowledged bytes, bytes in flight up to the window, and bytes it may not send yet; the window is the smaller of the receiver’s window and the congestion window',
      stream: 'The stream, as the sender sees it',
      acked: 'acknowledged',
      inflight: 'sent, not yet ACKed',
      allowed: 'may send now',
      blocked: 'must wait',
      window: 'window = min(rwnd, cwnd)',
      rwnd: ['rwnd · receive window', 'advertised by the receiver in every ACK', '“this much room is left in my buffer”', 'protects the receiver'],
      cwnd: ['cwnd · congestion window', 'kept by the sender, never sent', 'grows on ACKs, shrinks on loss', 'protects the network'],
      growth: 'cwnd over time',
      slow: 'slow start: ×2 per RTT',
      avoid: 'congestion avoidance: +1 per RTT',
      lossMark: 'loss',
      caption:
        'Two different brakes on one pedal. The receiver says how much it can take; the sender guesses how much the path can take, and the smaller number wins. The sawtooth is that guess being tested and corrected forever.',
    },
    ja: {
      aria: '送信側から見たバイトストリーム：確認済みのバイト、ウィンドウの範囲で送信中のバイト、まだ送れないバイト。ウィンドウは受信ウィンドウと輻輳ウィンドウの小さい方',
      stream: '送信側から見たストリーム',
      acked: '確認済み',
      inflight: '送信済み・未確認',
      allowed: '今すぐ送れる',
      blocked: '待つ必要あり',
      window: 'ウィンドウ = min(rwnd, cwnd)',
      rwnd: ['rwnd · 受信ウィンドウ', '受信側が毎回のACKで知らせる', '「バッファの空きはこれだけ」', '受信側を守る'],
      cwnd: ['cwnd · 輻輳ウィンドウ', '送信側が持つ値で、送られることはない', 'ACKで増え、ロスで減る', 'ネットワークを守る'],
      growth: 'cwndの時間変化',
      slow: 'スロースタート：RTTごとに2倍',
      avoid: '輻輳回避：RTTごとに+1',
      lossMark: 'ロス',
      caption:
        '1つのペダルに2つのブレーキ。受信側はどれだけ受け取れるかを伝え、送信側は経路がどれだけ運べるかを推測し、小さい方が勝ちます。のこぎり状の波形は、その推測を永遠に試しては直し続けている姿です。',
    },
  },
  render(l) {
    const parts = [];
    const x0 = 20;
    const bw = W - 40;
    const h = 28;
    const y = 36;
    parts.push(text(x0, 22, l.stream, 'd-title'));
    const segs = [
      [0, 0.3, 'all', l.acked],
      [0.3, 0.58, 'a', l.inflight],
      [0.58, 0.72, 'b', l.allowed],
      [0.72, 1, 'none', l.blocked],
    ];
    segs.forEach(([a, b, cls, label]) => {
      const sx = x0 + a * bw;
      const sw = (b - a) * bw - 3;
      parts.push(`<rect x="${sx}" y="${y}" width="${sw}" height="${h}" rx="4" class="d-strip d-strip-${cls}" />`);
      parts.push(text(sx + sw / 2, y + 18, label, 'd-strip-text', 'text-anchor="middle"'));
    });
    // Window bracket over in-flight + allowed
    const wx0 = x0 + 0.3 * bw;
    const wx1 = x0 + 0.72 * bw - 3;
    const wy = y + h + 8;
    parts.push(
      line(wx0, wy, wx0, wy + 8, { end: false, cls: 'primary' }),
      line(wx0, wy + 8, wx1, wy + 8, { end: false, cls: 'primary' }),
      line(wx1, wy, wx1, wy + 8, { end: false, cls: 'primary' }),
      text((wx0 + wx1) / 2, wy + 24, l.window, 'd-primary-text', 'text-anchor="middle"'),
    );
    // Two cards
    const cy = wy + 44;
    const c1 = card(20, cy, 380, l.rwnd[0], l.rwnd.slice(1).map((t) => ({ label: '', value: t })), { titleCls: 'd-secondary-text', labelW: 0 });
    const c2 = card(420, cy, 380, l.cwnd[0], l.cwnd.slice(1).map((t) => ({ label: '', value: t })), { titleCls: 'd-primary-text', labelW: 0 });
    parts.push(c1.svg, c2.svg);
    // Growth sketch: axes + polyline
    const gy = cy + c1.h + 26;
    const gh = 110;
    const gx = 60;
    const gw = W - 80;
    parts.push(text(gx, gy - 6, l.growth, 'd-title'));
    parts.push(line(gx, gy + gh, gx + gw, gy + gh, { end: false }));
    parts.push(line(gx, gy + gh, gx, gy, { end: false }));
    parts.push(text(gx - 6, gy + 10, 'cwnd', 'd-muted', 'text-anchor="end"'));
    parts.push(text(gx + gw, gy + gh + 14, 'RTT →', 'd-muted', 'text-anchor="end"'));
    // Exponential rise, loss, halve, linear, loss, halve, linear
    const pts = [];
    const base = gy + gh;
    const px = (t) => gx + 8 + t * 26;
    const py = (v) => base - v * 1.4;
    [1, 2, 4, 8, 16, 32].forEach((v, i) => pts.push([px(i), py(v)]));
    let t = 5;
    const lossPts = [];
    const sawtooth = (start, steps) => {
      let v = start;
      for (let i = 0; i < steps; i++) {
        t += 1;
        v += 4;
        pts.push([px(t), py(v)]);
      }
      lossPts.push([px(t), py(v)]);
      pts.push([px(t), py(v / 2)]);
      return v / 2;
    };
    let v = sawtooth(16, 7);
    v = sawtooth(v, 6);
    v = sawtooth(v, 6);
    for (let i = 0; i < 2; i++) {
      t += 1;
      v += 4;
      pts.push([px(t), py(v)]);
    }
    parts.push(`<polyline points="${pts.map((p) => p.join(',')).join(' ')}" class="d-line primary d-curve" />`);
    lossPts.forEach(([lx, ly]) => parts.push(`<path d="M${lx - 4} ${ly - 4} l8 8 M${lx + 4} ${ly - 4} l-8 8" class="d-x" />`));
    parts.push(text(lossPts[0][0] + 8, lossPts[0][1] - 6, l.lossMark, 'd-pink'));
    parts.push(text(px(0), gy + 14, l.slow, 'd-muted'));
    parts.push(text(px(14), gy + 14, l.avoid, 'd-muted'));
    return { svg: svg(W, gy + gh + 24, parts.join(''), { label: l.aria }), caption: l.caption };
  },
};

/* ---------- 7. Closing a connection ---------- */

export const netTcpClose = {
  labels: {
    en: {
      aria: 'Closing a TCP connection: FIN and ACK in each direction, with the states each side passes through and the TIME_WAIT period on the side that closed first',
      client: 'Side that closes first',
      server: 'Other side',
      fin1: 'FIN',
      fin1Sub: '“I have nothing more to send”',
      ack1: 'ACK',
      ack1Sub: 'can keep sending data for a while',
      fin2: 'FIN',
      ack2: 'ACK',
      s: {
        est: 'ESTABLISHED',
        fw1: 'FIN_WAIT_1',
        fw2: 'FIN_WAIT_2',
        cw: 'CLOSE_WAIT',
        la: 'LAST_ACK',
        tw: 'TIME_WAIT',
        closed: 'CLOSED',
      },
      twNote: ['stays 2 × MSL (60 s on Linux)', 'so a late packet can’t land', 'in a new connection on the same ports'],
      caption:
        'Each direction is closed separately, which is why there are four messages and why one side can still be reading after the other has finished writing. The side that closes first pays with TIME_WAIT; servers that close connections eagerly collect thousands of them.',
    },
    ja: {
      aria: 'TCP接続の終了：双方向のFINとACK、それぞれの側が通る状態、先に閉じた側のTIME_WAIT期間',
      client: '先に閉じる側',
      server: '相手側',
      fin1: 'FIN',
      fin1Sub: '「もう送るものはない」',
      ack1: 'ACK',
      ack1Sub: 'しばらくはデータを送り続けてもよい',
      fin2: 'FIN',
      ack2: 'ACK',
      s: {
        est: 'ESTABLISHED',
        fw1: 'FIN_WAIT_1',
        fw2: 'FIN_WAIT_2',
        cw: 'CLOSE_WAIT',
        la: 'LAST_ACK',
        tw: 'TIME_WAIT',
        closed: 'CLOSED',
      },
      twNote: ['2 × MSL（Linuxでは60秒）待つ', '遅れて届いたパケットが', '同じポートの新しい接続に紛れ込まないように'],
      caption:
        '方向ごとに別々に閉じるので、メッセージは4つになり、片方が書き終えた後ももう片方は読み続けられます。先に閉じた側はTIME_WAITという代償を払います。接続を積極的に閉じるサーバーには、これが何千と溜まります。',
    },
  },
  render(l) {
    const id = 'net-close';
    const mp = `${id}-p`;
    const ms = `${id}-s`;
    const H = 356;
    const parts = [actors(l.client, l.server, H, { headW: 190 })];
    parts.push(note('l', 70, l.s.est), note('r', 70, l.s.est));
    parts.push(msg('l', 84, l.fin1, mp, { cls: 'primary', sub: l.fin1Sub }));
    parts.push(note('l', 96, l.s.fw1, 'd-primary-text'));
    parts.push(note('r', 114, l.s.cw, 'd-secondary-text'));
    parts.push(msg('r', 136, l.ack1, ms, { cls: 'secondary', sub: l.ack1Sub }));
    parts.push(note('l', 170, l.s.fw2, 'd-primary-text'));
    parts.push(note('r', 196, l.s.la, 'd-secondary-text'));
    parts.push(msg('r', 204, l.fin2, ms, { cls: 'secondary' }));
    parts.push(note('l', 240, l.s.tw, 'd-pink'));
    parts.push(msg('l', 244, l.ack2, mp, { cls: 'primary' }));
    parts.push(note('r', 276, l.s.closed, 'd-secondary-text'));
    parts.push(shade(244, H - 12));
    l.twNote.forEach((t, i) => parts.push(text(SEQ.l + 16, 284 + i * 14, t, 'd-muted')));
    parts.push(note('l', 340, l.s.closed));
    return {
      svg: svg(W, H, parts.join(''), { label: l.aria, defs: marker(mp, 'primary') + marker(ms, 'secondary') }),
      caption: l.caption,
    };
  },
};

/* ---------- 8. The TLS 1.3 handshake ---------- */

export const netTlsHandshake = {
  labels: {
    en: {
      aria: 'TLS 1.3 handshake: ClientHello with key share, SNI and ALPN; ServerHello with key share, then encrypted certificate, signature and Finished; client Finished together with the first HTTP request',
      client: 'Client',
      server: 'Server',
      ch: 'ClientHello',
      chSub: 'key share · SNI · ALPN · cipher list',
      sh: 'ServerHello',
      shSub: 'key share · chosen cipher',
      enc: ['encrypted', 'from here ↓'],
      certs: '{ Certificate · CertificateVerify · Finished }',
      certsSub: '+ EncryptedExtensions · chain, signature, handshake checksum',
      fin: '{ Finished }  +  GET /orders HTTP/2',
      finSub: 'the first request leaves in the same flight',
      keysL: ['same secret', 'on both sides'],
      keysR: ['derives', 'the keys'],
      verify: ['client checks', 'chain → root', 'hostname', 'signature'],
      rtt: ['1 RTT', 'to secure', 'the channel'],
      caption:
        'Each side sends one public key share in the clear and combines it with its own private key; the secret they both compute never crosses the wire. Everything after ServerHello is already encrypted, including the certificate.',
    },
    ja: {
      aria: 'TLS 1.3ハンドシェイク：鍵共有・SNI・ALPNを含むClientHello、鍵共有を含むServerHello、その後に暗号化された証明書・署名・Finished、クライアントのFinishedと最初のHTTPリクエスト',
      client: 'クライアント',
      server: 'サーバー',
      ch: 'ClientHello',
      chSub: '鍵共有 · SNI · ALPN · 暗号スイート一覧',
      sh: 'ServerHello',
      shSub: '鍵共有 · 選んだ暗号スイート',
      enc: ['ここから', '暗号化 ↓'],
      certs: '{ Certificate · CertificateVerify · Finished }',
      certsSub: '+ EncryptedExtensions · チェーン、署名、チェックサム',
      fin: '{ Finished }  +  GET /orders HTTP/2',
      finSub: '最初のリクエストが同じ往路に相乗りする',
      keysL: ['双方が同じ', '秘密を持つ'],
      keysR: ['鍵を', '導出'],
      verify: ['クライアントの検証', 'チェーン → ルート', 'ホスト名', '署名'],
      rtt: ['1 RTT', 'で暗号路が', '完成'],
      caption:
        '双方が公開鍵の共有値を平文で1つ送り、自分の秘密鍵と組み合わせます。両者が計算する秘密そのものは一度も回線を通りません。ServerHello以降は証明書も含めてすべて暗号化されています。',
    },
  },
  render(l) {
    const id = 'net-tls';
    const mp = `${id}-p`;
    const ms = `${id}-s`;
    const H = 350;
    const parts = [];
    parts.push(shade(170, H - 12));
    parts.push(actors(l.client, l.server, H));
    parts.push(msg('l', 70, l.ch, mp, { cls: 'primary', sub: l.chSub }));
    parts.push(msg('r', 124, l.sh, ms, { cls: 'secondary', sub: l.shSub }));
    l.keysR.forEach((t, i) => parts.push(note('r', 118 + i * 14, t)));
    l.enc.forEach((t, i) => parts.push(note('r', 178 + i * 14, t, 'd-primary-text')));
    parts.push(msg('r', 190, l.certs, ms, { cls: 'secondary', sub: l.certsSub }));
    l.keysL.forEach((t, i) => parts.push(note('l', 156 + i * 14, t)));
    l.verify.forEach((t, i) => parts.push(note('l', 226 + i * 14, t, i === 0 ? 'd-primary-text' : 'd-muted')));
    parts.push(msg('l', 300, l.fin, mp, { cls: 'primary', sub: l.finSub }));
    parts.push(bracket(70, 300, l.rtt));
    return {
      svg: svg(W, H, parts.join(''), { label: l.aria, defs: marker(mp, 'primary') + marker(ms, 'secondary') }),
      caption: l.caption,
    };
  },
};

/* ---------- 9. The certificate chain ---------- */

export const netCertChain = {
  labels: {
    en: {
      aria: 'Certificate chain: a root CA in the device’s trust store signs an intermediate CA, which signs the server’s certificate for the hostname',
      boxes: [
        ['Root CA', 'ISRG Root X1', 'self-signed · valid ~20 years'],
        ['Intermediate CA', 'Let’s Encrypt R11', 'signed by the root · valid ~3 years'],
        ['Server certificate', 'CN / SAN: api.example.com', 'signed by the intermediate · valid 90 days'],
      ],
      signs: 'signs',
      have: 'already on your device: the OS / browser trust store',
      sent: 'sent by the server during the handshake',
      checks: ['What the client checks', 'every signature in the chain is valid', 'the chain ends at a root it trusts', 'today is inside each validity window', 'the hostname matches a SAN entry', 'none of them is revoked (OCSP / CRL)'],
      caption:
        'Trust flows from a short list your device shipped with. The server proves it holds the private key for the last certificate, and the chain proves that key was vouched for by someone your device already trusts.',
    },
    ja: {
      aria: '証明書チェーン：端末の信頼ストアにあるルートCAが中間CAに署名し、中間CAがホスト名に対するサーバー証明書に署名する',
      boxes: [
        ['ルートCA', 'ISRG Root X1', '自己署名 · 有効期間 約20年'],
        ['中間CA', 'Let’s Encrypt R11', 'ルートが署名 · 有効期間 約3年'],
        ['サーバー証明書', 'CN / SAN: api.example.com', '中間CAが署名 · 有効期間 90日'],
      ],
      signs: '署名',
      have: '端末に最初から入っている：OS / ブラウザの信頼ストア',
      sent: 'ハンドシェイク中にサーバーが送る',
      checks: ['クライアントが確認すること', 'チェーン内のすべての署名が正しい', 'チェーンが信頼するルートで終わる', '今日が各有効期間の中にある', 'ホスト名がSANのいずれかと一致する', 'どれも失効していない（OCSP / CRL）'],
      caption:
        '信頼の出発点は、端末に最初から入っている短いリストです。サーバーは最後の証明書の秘密鍵を持っていることを証明し、チェーンはその鍵が端末のすでに信頼する誰かに保証されていることを証明します。',
    },
  },
  render(l) {
    const id = 'net-cert';
    const m = `${id}-a`;
    const parts = [];
    const bx = 40;
    const bw = 340;
    const bh = 64;
    const ys = [40, 150, 260];
    // Backgrounds: trust store around the root, "sent" around the other two
    parts.push(`<rect x="${bx - 14}" y="${ys[0] - 26}" width="${bw + 28}" height="${bh + 36}" rx="10" class="d-band" />`);
    parts.push(text(bx, ys[0] - 10, l.have, 'd-band-label'));
    parts.push(`<rect x="${bx - 14}" y="${ys[1] - 10}" width="${bw + 28}" height="${ys[2] - ys[1] + bh + 46}" rx="10" class="d-band" />`);
    parts.push(text(bx, ys[2] + bh + 26, l.sent, 'd-band-label'));
    l.boxes.forEach(([t, name, sub], i) => {
      const y = ys[i];
      parts.push(`<rect x="${bx}" y="${y}" width="${bw}" height="${bh}" rx="8" class="${i === 2 ? 'd-box d-box-owner' : 'd-box'}" />`);
      parts.push(text(bx + 14, y + 20, t, 'd-title'));
      parts.push(text(bx + 14, y + 38, name, 'd-text'));
      parts.push(text(bx + 14, y + 54, sub, 'd-muted'));
      if (i < 2) {
        parts.push(line(bx + bw / 2, y + bh, bx + bw / 2, ys[i + 1], { markerId: m, cls: 'primary' }));
        parts.push(text(bx + bw / 2 + 10, (y + bh + ys[i + 1]) / 2 + 4, l.signs, 'd-primary-text'));
      }
    });
    const c = card(440, 60, 350, l.checks[0], l.checks.slice(1).map((t) => ({ label: '✓', value: t })), { labelW: 18 });
    parts.push(c.svg);
    return { svg: svg(W, ys[2] + bh + 46, parts.join(''), { label: l.aria, defs: marker(m, 'primary') }), caption: l.caption };
  },
};

/* ---------- 10. Framing: three layers, three sets of boundaries ---------- */

export const netFraming = {
  labels: {
    en: {
      aria: 'One HTTP response split into TLS records, which are split into TCP segments: each layer draws its own boundaries and none of them line up',
      http: 'HTTP/1.1',
      httpParts: ['status line · headers · blank line', 'body · Content-Length: 5120 bytes'],
      httpNote: 'ends headers with \\r\\n\\r\\n, then reads exactly Content-Length bytes',
      tls: 'TLS records',
      tlsHead: '5-byte header: type · version · length',
      tlsNote: 'each record is decrypted and checked on its own, max 16 KB',
      tcp: 'TCP segments',
      tcpNote: 'cut wherever the MSS falls; the receiver glues them back into a stream',
      caption:
        'Three layers, three rulers. TCP cuts by packet size, TLS cuts by record, HTTP cuts by its own headers. Each layer reads its own length fields out of the stream below it and never sees the boundaries of the others.',
    },
    ja: {
      aria: '1つのHTTPレスポンスがTLSレコードに分かれ、さらにTCPセグメントに分かれる。各層が独自の境界を引き、どれも揃わない',
      http: 'HTTP/1.1',
      httpParts: ['ステータス行 · ヘッダー · 空行', 'ボディ · Content-Length: 5120バイト'],
      httpNote: '\\r\\n\\r\\nでヘッダーを終え、Content-Lengthぶんだけ読む',
      tls: 'TLSレコード',
      tlsHead: '5バイトのヘッダー：type · version · length',
      tlsNote: 'レコードごとに復号と検証を行う。最大16KB',
      tcp: 'TCPセグメント',
      tcpNote: 'MSSの位置で切られ、受信側がストリームに貼り直す',
      caption:
        '3つの層、3本の物差し。TCPはパケットサイズで、TLSはレコードで、HTTPは自分のヘッダーで切ります。各層は下の層のストリームから自分の長さフィールドだけを読み、他の層の境界は一切見ません。',
    },
  },
  render(l) {
    const x0 = 150;
    const bw = W - x0 - 20;
    const h = 28;
    const parts = [];
    const row = (y, title, note) => text(x0 - 12, y + 18, title, 'd-title', 'text-anchor="end"') + text(x0, y + h + 16, note, 'd-muted');
    // HTTP: headers then body
    let y = 20;
    parts.push(row(y, l.http, l.httpNote));
    const hdrW = bw * 0.4;
    parts.push(`<rect x="${x0}" y="${y}" width="${hdrW - 3}" height="${h}" rx="4" class="d-strip d-strip-b" />`);
    parts.push(text(x0 + hdrW / 2, y + 18, l.httpParts[0], 'd-strip-text', 'text-anchor="middle"'));
    parts.push(`<rect x="${x0 + hdrW}" y="${y}" width="${bw - hdrW}" height="${h}" rx="4" class="d-strip d-strip-a" />`);
    parts.push(text(x0 + hdrW + (bw - hdrW) / 2, y + 18, l.httpParts[1], 'd-strip-text', 'text-anchor="middle"'));
    // TLS records: 3 records with small header blocks
    y = 92;
    parts.push(row(y, l.tls, l.tlsNote));
    const recs = [0, 0.44, 0.75, 1];
    for (let i = 0; i < 3; i++) {
      const rx = x0 + recs[i] * bw;
      const rw = (recs[i + 1] - recs[i]) * bw - 3;
      parts.push(`<rect x="${rx}" y="${y}" width="18" height="${h}" rx="4" class="d-strip d-strip-c" />`);
      parts.push(`<rect x="${rx + 18}" y="${y}" width="${rw - 18}" height="${h}" rx="4" class="d-strip d-strip-none" />`);
      parts.push(text(rx + 18 + (rw - 18) / 2, y + 18, i === 0 ? l.tlsHead : '{ … }', 'd-strip-text', 'text-anchor="middle"'));
    }
    // TCP segments: 5 segments
    y = 164;
    parts.push(row(y, l.tcp, l.tcpNote));
    const n = 5;
    for (let i = 0; i < n; i++) {
      const sx = x0 + (i / n) * bw;
      const sw = bw / n - 3;
      parts.push(`<rect x="${sx}" y="${y}" width="${sw}" height="${h}" rx="4" class="d-strip d-strip-all" />`);
      parts.push(text(sx + sw / 2, y + 18, `seg ${i + 1}`, 'd-strip-text', 'text-anchor="middle"'));
    }
    // Dotted guides from TLS record boundaries down through the TCP row to show misalignment
    for (let i = 1; i < 3; i++) {
      const gx = x0 + recs[i] * bw - 1.5;
      parts.push(line(gx, 92 + h + 2, gx, y + h, { end: false, dashed: true, cls: 'pink' }));
    }
    parts.push(line(x0 + hdrW - 1.5, 20 + h + 2, x0 + hdrW - 1.5, 92 + h, { end: false, dashed: true, cls: 'pink' }));
    return { svg: svg(W, y + h + 30, parts.join(''), { label: l.aria }), caption: l.caption };
  },
};

/* ---------- 11. Round trips to the first byte ---------- */

export const netFirstByte = {
  labels: {
    en: {
      aria: 'Round trips before the first byte of an HTTP response arrives, for TLS 1.2, TLS 1.3, TLS 1.3 with 0-RTT resumption, QUIC, QUIC with 0-RTT, and a reused connection',
      rows: [
        ['TLS 1.2 over TCP', [['tcp', 1], ['tls', 2], ['http', 1]]],
        ['TLS 1.3 over TCP', [['tcp', 1], ['tls', 1], ['http', 1]]],
        ['TLS 1.3, resumed with 0-RTT', [['tcp', 1], ['http', 1]]],
        ['HTTP/3 · QUIC, first visit', [['tls', 1], ['http', 1]]],
        ['HTTP/3 · QUIC, resumed 0-RTT', [['http', 1]]],
        ['any version, connection reused', [['http', 1]]],
      ],
      legend: [['tcp', 'TCP handshake'], ['tls', 'TLS handshake'], ['http', 'request → first byte']],
      unit: 'RTT',
      caption:
        'Every bar ends with the same request/response trip; the rest is setup. At 80 ms per round trip, TLS 1.2 spends 240 ms before the request even leaves, and a reused connection spends nothing.',
    },
    ja: {
      aria: 'HTTPレスポンスの最初のバイトが届くまでの往復回数：TLS 1.2、TLS 1.3、0-RTT再開のTLS 1.3、QUIC、0-RTTのQUIC、再利用した接続',
      rows: [
        ['TLS 1.2 over TCP', [['tcp', 1], ['tls', 2], ['http', 1]]],
        ['TLS 1.3 over TCP', [['tcp', 1], ['tls', 1], ['http', 1]]],
        ['TLS 1.3、0-RTTで再開', [['tcp', 1], ['http', 1]]],
        ['HTTP/3 · QUIC、初回', [['tls', 1], ['http', 1]]],
        ['HTTP/3 · QUIC、0-RTTで再開', [['http', 1]]],
        ['どのバージョンでも、接続を再利用', [['http', 1]]],
      ],
      legend: [['tcp', 'TCPハンドシェイク'], ['tls', 'TLSハンドシェイク'], ['http', 'リクエスト → 最初のバイト']],
      unit: 'RTT',
      caption:
        'どの棒も最後は同じリクエスト/レスポンスの往復で終わり、残りはすべて準備です。1往復80msなら、TLS 1.2はリクエストが出る前に240msを使い、再利用した接続は何も使いません。',
    },
  },
  render(l) {
    const parts = [];
    const x0 = 290;
    const unit = 120;
    const h = 24;
    const rowH = 40;
    const top = 30;
    // Axis ticks
    for (let i = 0; i <= 4; i++) {
      const tx = x0 + i * unit;
      parts.push(line(tx, top - 8, tx, top + l.rows.length * rowH - 10, { end: false, dashed: true }));
      parts.push(text(tx, top - 12, `${i} ${l.unit}`, 'd-muted', 'text-anchor="middle"'));
    }
    l.rows.forEach(([name, phases], ri) => {
      const y = top + ri * rowH;
      parts.push(text(x0 - 12, y + 16, name, 'd-text', 'text-anchor="end"'));
      let x = x0;
      phases.forEach(([cls, n]) => {
        const w = n * unit - 3;
        parts.push(`<rect x="${x + 1}" y="${y}" width="${w}" height="${h}" rx="4" class="d-strip d-phase-${cls}" />`);
        x += n * unit;
      });
      const total = phases.reduce((s, [, n]) => s + n, 0);
      parts.push(text(x + 6, y + 16, `${total}`, 'd-title'));
    });
    let lx = x0;
    const ly = top + l.rows.length * rowH + 12;
    l.legend.forEach(([cls, label]) => {
      parts.push(`<rect x="${lx}" y="${ly - 10}" width="14" height="14" rx="3" class="d-strip d-phase-${cls}" />`, text(lx + 20, ly + 1, label, 'd-muted'));
      lx += 24 + label.length * (/[^\x00-\x7f]/.test(label) ? 11.5 : 6.8) + 22;
    });
    return { svg: svg(W, ly + 16, parts.join(''), { label: l.aria }), caption: l.caption };
  },
};

/* ---------- 12. HTTP/1.1, HTTP/2 and HTTP/3 as stacks ---------- */

export const netHttpVersions = {
  labels: {
    en: {
      aria: 'Three protocol stacks side by side: HTTP/1.1 and HTTP/2 both run over TLS over TCP; HTTP/3 runs over QUIC over UDP with TLS 1.3 built into QUIC',
      cols: [
        { title: 'HTTP/1.1', stack: ['HTTP/1.1 · text', 'TLS', 'TCP', 'IP'], notes: ['one request at a time per connection', 'browsers open ~6 connections per host', 'headers sent in full every time'] },
        { title: 'HTTP/2', stack: ['HTTP/2 · binary frames', 'TLS', 'TCP', 'IP'], notes: ['many streams on one connection', 'HPACK header compression', 'one lost packet stalls every stream'] },
        { title: 'HTTP/3', stack: ['HTTP/3 · binary frames', 'QUIC (TLS 1.3 inside)', 'UDP', 'IP'], notes: ['streams recover losses independently', '1 RTT setup, 0 on resumption', 'survives a change of IP address'] },
      ],
      merged: 'TLS is inside QUIC, not a layer above it',
      caption:
        'HTTP/2 fixed HTTP’s head-of-line problem and moved it down into TCP. HTTP/3 fixes that by replacing TCP with QUIC, which does ordering per stream and folds the TLS handshake into its own.',
    },
    ja: {
      aria: '3つのプロトコルスタックの比較：HTTP/1.1とHTTP/2はTLS over TCP、HTTP/3はTLS 1.3を内蔵したQUIC over UDP',
      cols: [
        { title: 'HTTP/1.1', stack: ['HTTP/1.1 · テキスト', 'TLS', 'TCP', 'IP'], notes: ['接続ごとに一度に1リクエスト', 'ブラウザはホストごとに約6接続を開く', 'ヘッダーを毎回まるごと送る'] },
        { title: 'HTTP/2', stack: ['HTTP/2 · バイナリフレーム', 'TLS', 'TCP', 'IP'], notes: ['1接続に多数のストリーム', 'HPACKによるヘッダー圧縮', 'パケット1つの消失で全ストリームが止まる'] },
        { title: 'HTTP/3', stack: ['HTTP/3 · バイナリフレーム', 'QUIC（TLS 1.3を内蔵）', 'UDP', 'IP'], notes: ['ストリームごとに独立して回復', '準備は1 RTT、再開なら0', 'IPアドレスが変わっても接続が続く'] },
      ],
      merged: 'TLSはQUICの上ではなく中にある',
      caption:
        'HTTP/2はHTTPのヘッドオブラインブロッキングを解決し、その問題をTCPに押し下げました。HTTP/3はTCPをQUICに置き換えてそれを解決します。QUICはストリームごとに順序を保証し、TLSのハンドシェイクを自分のものに畳み込みます。',
    },
  },
  render(l) {
    const parts = [];
    const colW = 250;
    const gap = 15;
    const x0 = 20;
    const bh = 36;
    const top = 44;
    l.cols.forEach((c, ci) => {
      const x = x0 + ci * (colW + gap);
      parts.push(text(x + colW / 2, 26, c.title, 'd-title', 'text-anchor="middle"'));
      c.stack.forEach((layer, li) => {
        const y = top + li * (bh + 6);
        const isHttp = li === 0;
        const isQuic = ci === 2 && li === 1;
        const cls = isHttp ? 'd-box d-box-owner' : isQuic ? 'd-box d-box-quic' : 'd-box';
        parts.push(`<rect x="${x}" y="${y}" width="${colW}" height="${bh}" rx="6" class="${cls}" />`);
        parts.push(text(x + colW / 2, y + bh / 2 + 4, layer, 'd-text', 'text-anchor="middle"'));
      });
      const ny = top + c.stack.length * (bh + 6) + 14;
      c.notes.forEach((n, i) => parts.push(text(x + 4, ny + i * 17, `· ${n}`, 'd-muted')));
    });
    const H = top + 4 * (bh + 6) + 14 + 3 * 17 + 24;
    parts.push(text(x0 + 2 * (colW + gap) + colW / 2, H - 8, l.merged, 'd-secondary-text', 'text-anchor="middle"'));
    return { svg: svg(W, H + 4, parts.join(''), { label: l.aria }), caption: l.caption };
  },
};

/* ---------- 13. The path through the server ---------- */

export const netServerPath = {
  labels: {
    en: {
      aria: 'A request passing through a server: network card, kernel IP and TCP, socket, TLS library, HTTP parser, application handler, with the form the data takes at each step',
      steps: [
        ['Network card', 'Ethernet frames'],
        ['Kernel · IP', 'packets'],
        ['Kernel · TCP', 'ordered byte stream'],
        ['TLS library', 'plaintext bytes'],
        ['HTTP parser', 'request object'],
        ['Your handler', 'def get_orders(request)'],
      ],
      socketLine: 'socket · read()',
      lbNote: ['With a layer 7 load balancer in front, the TLS step happens there instead,', 'and the app server’s TLS library is never used: it receives plain HTTP on a private port.'],
      caption:
        'Each box consumes one layer and hands up something simpler. By the time your function runs, five layers of headers have been read and thrown away, and only the request they carried is left.',
    },
    ja: {
      aria: 'サーバー内を通るリクエスト：ネットワークカード、カーネルのIPとTCP、ソケット、TLSライブラリ、HTTPパーサー、アプリケーションのハンドラーと、各段階でのデータの形',
      steps: [
        ['ネットワークカード', 'Ethernetフレーム'],
        ['カーネル · IP', 'パケット'],
        ['カーネル · TCP', '順序付きバイト列'],
        ['TLSライブラリ', '平文のバイト列'],
        ['HTTPパーサー', 'リクエストオブジェクト'],
        ['自分のハンドラー', 'def get_orders(request)'],
      ],
      socketLine: 'ソケット · read()',
      lbNote: ['前にレイヤー7ロードバランサーがあれば、TLSの段階はそちらで行われ、', 'アプリサーバーのTLSライブラリは使われません。プライベートなポートで平文のHTTPを受け取ります。'],
      caption:
        '各ボックスは1つの層を消費し、より単純なものを上に渡します。自分の関数が走るころには5層分のヘッダーが読まれて捨てられ、それらが運んでいたリクエストだけが残っています。',
    },
  },
  render(l) {
    const id = 'net-srv';
    const m = `${id}-a`;
    const parts = [];
    const n = l.steps.length;
    const bw = 118;
    const gap = (W - 40 - n * bw) / (n - 1);
    const y = 40;
    const bh = 44;
    l.steps.forEach(([title, form], i) => {
      const x = 20 + i * (bw + gap);
      parts.push(`<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8" class="${i === n - 1 ? 'd-box d-box-owner' : 'd-box'}" />`);
      parts.push(text(x + bw / 2, y + bh / 2 + 4, title, 'd-title', 'text-anchor="middle"'));
      parts.push(text(x + bw / 2, y + bh + 20, form, 'd-muted', 'text-anchor="middle"'));
      if (i < n - 1) parts.push(line(x + bw, y + bh / 2, x + bw + gap, y + bh / 2, i >= 2 ? { markerId: `${id}-p`, cls: 'primary' } : { markerId: m }));
    });
    // Socket boundary between kernel TCP and TLS library
    const sx = 20 + 3 * (bw + gap) - gap / 2;
    parts.push(line(sx, 14, sx, 120, { end: false, dashed: true, cls: 'primary' }));
    parts.push(text(sx, 134, l.socketLine, 'd-primary-text', 'text-anchor="middle"'));
    l.lbNote.forEach((t, i) => parts.push(text(20, 164 + i * 15, t, 'd-muted')));
    return { svg: svg(W, 190, parts.join(''), { label: l.aria, defs: marker(m) + marker(`${id}-p`, 'primary') }), caption: l.caption };
  },
};
