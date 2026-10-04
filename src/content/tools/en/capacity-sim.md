---
title: System Capacity Simulator
description: Build a simple architecture — servers, load balancer, cache, database, replicas — tune the hardware and traffic, and see where it breaks.
image: /tools/capacity-sim/thumb.svg
lang: en
order: 1
updatedDate: 2026-10-03
inProgress: true
tags: ['System Design', 'Visualization', 'Vue 3', 'TypeScript']
component: capacity-sim
---

<nav class="toc" aria-label="On this page">

**On this page**

- [Parameters explained](#parameters-explained)
  - [App server](#app-server)
    - [Servers](#servers)
    - [Server type](#server-type)
    - [Workers / server](#workers--server)
    - [vCPU](#vcpu)
    - [CPU time / request](#cpu-time--request)
    - [RAM](#ram)
    - [Memory / worker](#memory--worker)
    - [Memory / request](#memory--request)
    - [Network](#network)
    - [DB connections / worker](#db-connections--worker)
  - [Database](#database)
    - [vCPU](#vcpu-1)
    - [Query time](#query-time)
    - [Max connections](#max-connections)
    - [Read replicas](#read-replicas)
  - [What if many requests arrive at once?](#what-if-many-requests-arrive-at-once)
- [Key concepts](#key-concepts)
  - [Max sustainable and the bottleneck](#max-sustainable-and-the-bottleneck)
  - [Time here: why requests wait before 100%](#time-here-why-requests-wait-before-100)
  - [End-to-end latency](#end-to-end-latency)
  - [Past 100%: errors and timeouts](#past-100-errors-and-timeouts)
- [Assumptions](#assumptions)

</nav>

## Parameters explained

Every component has a few resources, and each one caps how many requests per second the component can handle. Below, these are written as **max req/s from** a resource, for example max req/s from CPU (the database counts queries instead, so it's max queries/s). The component can handle whichever is lowest, and the bars in the diagram show how close each resource is to its maximum (load / max).

The examples below use the default **One VPS** scenario: an async server with 2 workers, 2 vCPU, 4 GB RAM, 10 ms of CPU per request, a database that takes 4 ms per query, and 3 queries per request.

### App server

#### Servers

How many identical app servers share the traffic. A load balancer splits requests evenly, so each server gets traffic / servers. Without a load balancer, clients can only reach one server, so extra servers sit idle.

#### Server type

How the server runs requests:

- **Async**: each worker process juggles many requests at once, switching between them whenever one waits on the database (Node.js, or FastAPI with async code).
- **Sync**: each worker handles one request at a time, from start to finish (Gunicorn sync workers, PHP-FPM, Unicorn).

This mostly changes how memory and the number of workers limit the server, as explained under RAM below.

#### Workers / server

How many worker processes run on each server.

**Workers and cores.** A worker can only use one core at a time, but a core can be shared by many workers, which take turns on it. So:

- **Fewer workers than cores:** the extra cores sit idle, and the simulator warns you.
- **More workers than cores:** every core can be used.

Async servers usually run one worker per core, since each worker already juggles many requests. Sync servers usually run more workers than cores, for the reason below. A common starting point is Gunicorn's guideline of **(2 × cores) + 1**, so 5 workers on a 2-core server. When you switch the server type, the simulator sets workers to these defaults: one per core for async, and (2 × cores) + 1 for sync. It also resets DB connections / worker (see below).

**Why sync servers want more workers than cores.** A sync worker handles one request from start to finish, and much of that time is spent waiting on the database, when it doesn't need a core at all. In the default setup a request takes about 22 ms: 10 ms of CPU, then 12 ms waiting on three queries. With 4 workers (A to D) on 2 cores:

| | 0–10 ms | 10–20 ms | 20–30 ms |
| --- | --- | --- | --- |
| Core 1 | A uses the CPU | C uses the CPU | A starts its next request |
| Core 2 | B uses the CPU | D uses the CPU | B starts its next request |
| Database | – | A and B are waiting | C and D are waiting |

All 4 requests are in progress at once, but only 2 are using a core at any moment. When A starts waiting on the database, its core is free for C. With only 2 workers, each core would sit idle during every database wait.

**The most requests the workers can handle.** A sync worker is tied up for a request's whole time in flight, so the workers can only get through so many requests per second:

$$
\text{max req/s from workers} = \dfrac{\text{workers}}{\text{time each request is in flight (s)}}
$$

One worker that's busy for 22 ms per request finishes 1000 / 22 ≈ **45 requests per second**, so 4 workers can handle at most **182**. Your traffic per server needs to stay below that, as with every maximum in the simulator. If requests arrive faster than the workers can finish them, the extra ones wait in line for a free worker, latency climbs, and eventually requests time out. The WORK bar on the app server shows how close you are.

**How many workers is right?** Enough to keep every core busy while other workers wait on the database:

$$
\text{workers needed} \approx \text{cores} \times \dfrac{\text{time in flight (ms)}}{\text{CPU time per request (ms)}}
$$

With the defaults, that's 2 × 22 / 10 ≈ 4.4, so about 5. It matches Gunicorn's guideline of (2 × cores) + 1, because these requests spend about half their time waiting. The longer requests wait compared with using the CPU, the more workers you need.

**What happens with too many?** Past that point, more workers stop helping and start costing:

- **CPU:** once every core is busy, extra workers just take turns on the same cores. Each request takes longer and throughput stays flat, so the CPU becomes the bottleneck instead.
- **RAM:** every worker costs its full base memory. Workers beyond "Max that fits in RAM" would be killed for running out of memory.
- **Database connections:** each worker opens its own pool, so too many workers can exceed the database's **Max connections**.
- **Overhead:** with hundreds of processes, the OS spends real time switching between them. The simulator doesn't model this.

#### vCPU

A virtual CPU core, the unit cloud providers sell compute in. Each core can work on one thing at a time, and it has 1,000 ms of working time every second. A worker process uses one core at a time, so the cores that can actually be used are the smaller of workers and vCPU. That gives the most requests per second the CPU can handle:

$$
\text{max req/s from CPU} = \dfrac{\min(\text{workers},\ \text{vCPU}) \times 1000}{\text{CPU time per request (ms)}}
$$

If a request needs 10 ms of CPU, one core can finish 1000 / 10 = **100 requests per second**, and 2 cores with 2 workers can finish **200**. Past that point, requests arrive faster than the cores can work through them, so a queue builds up. More cores also mean less waiting before that point: with several cores, a new request is more likely to find one free.

#### CPU time / request

How long the server's CPU actively works on one request: running your code, building the response, serializing JSON. It doesn't include time spent waiting for the database, because the CPU is free to work on other requests while it waits. Halving it doubles how many requests per second the CPU can handle.

Some typical values, for CPU time only (database waits not included):

| Request | Typical CPU time |
| --- | --- |
| Health check or a small fixed JSON response | **under 1 ms** |
| CRUD read: fetch one record and return it as JSON | **1–5 ms** |
| CRUD write: validate input, save a record | **2–10 ms** |
| Server-rendered HTML page | **5–30 ms** |
| List endpoint returning a few hundred rows | **10–50 ms** |
| Login, because password hashing is slow on purpose (bcrypt) | **50–300 ms** |
| Resizing an image or generating a PDF | **100 ms to a few seconds** |

These are rough figures. Compiled languages like Go or Java usually sit at the low end, and Python or Ruby frameworks toward the high end. The simulator's default of 10 ms is a typical mix for a web API. A handful of heavy endpoints, like login or exports, can drag the average up a lot.

#### RAM

The OS keeps about 10% of the server's RAM. The rest is shared by the worker processes and the requests they're handling. Each worker has a fixed base (**Memory / worker**), and each request in progress holds a bit more on top (**Memory / request**):

$$
\text{memory used} \approx \text{workers} \times \text{memory per worker} + \text{requests in flight} \times \text{memory per request}
$$

How that limits the server depends on the server type.

**Async server.** The workers' base is paid once, and whatever is left over holds requests in progress:

$$
\text{requests in flight} = \dfrac{\text{RAM} \times 90\% - \text{workers} \times \text{memory per worker}}{\text{memory per request}}
$$

That's how many requests fit in memory at once, not how many per second. To turn it into a rate, the simulator uses **Little's law**: if each request stays in flight for a certain time, then

$$
\text{max req/s from RAM} = \dfrac{\text{requests in flight}}{\text{time each request is in flight (s)}}
$$

A request stays in flight for its CPU time **plus** the time it waits on the cache and database. With the defaults, (3,686 MB − 2 × 100 MB) / 100 KB ≈ 34,900 requests fit at once. Each stays about 22 ms (10 ms of CPU plus three 4 ms queries), so 34,900 / 0.022 s ≈ **1.6 million requests per second**. On an async server, memory is almost never the limit.

**Sync server.** Every request in progress needs a whole worker, and each worker holds its base memory plus its one request. So RAM decides how many workers fit:

$$
\text{workers that fit} = \dfrac{\text{RAM} \times 90\%}{\text{memory per worker} + \text{memory per request}}
$$

Each worker serves one request at a time, so Little's law turns that into a rate the same way:

$$
\text{max req/s from RAM} = \dfrac{\text{workers that fit}}{\text{time each request is in flight (s)}}
$$

With 4 GB, 100 MB workers and 50 MB requests, 3,686 / 150 ≈ 24 workers fit, so 24 / 0.022 s ≈ **1,090 requests per second**. If you set more workers than fit, the extra ones would be killed for running out of memory, and the simulator warns you.

Either way, slow database queries hurt app servers too: requests stay in flight longer, so fewer get through with the same memory or workers.

#### Memory / worker

The base memory of one worker process before it handles any requests: the language runtime, your framework and libraries, loaded code, caches and its database connection pool. Typical Python or Node.js web workers use 50–150 MB, and heavy libraries such as pandas or machine learning models can push that to several hundred MB.

A worker holds this memory even while it's idle. After busy periods it also tends to stay at its peak, because freed memory isn't always returned to the OS. That's why some setups restart workers every so often, like Gunicorn's `--max-requests` option.

#### Memory / request

How much RAM one in-flight request holds, on top of its worker's base memory. Heavy requests (large uploads, big result sets) can make memory the limit before CPU.

How much a request holds depends a lot on how the server runs requests:

| Request or server type | Typical memory per in-flight request |
| --- | --- |
| Small JSON request on an async server (Node.js, Go, FastAPI) | **well under 1 MB** |
| Small request on a thread-per-request server (Java, .NET) | **up to about 1 MB, mostly the thread's stack** |
| Request that loads a few hundred rows into memory | **1–10 MB** |
| File upload or large JSON body held in memory | **about the payload size, e.g. 5–50 MB** |
| Image processing (a 12-megapixel photo, decoded) | **about 50 MB per image** |
| An async worker process itself (e.g. FastAPI on Uvicorn), paid once and shared by all its requests | **50–150 MB per worker** |
| Process-per-request server (Gunicorn sync workers, Unicorn, PHP-FPM) | **the whole worker process: 30–300 MB** |

The last two rows are the important ones, and in the simulator they're set with **Memory / worker** rather than here. On an async server, that base is paid once per worker and shared, so a request itself usually holds well under 1 MB (the default is 100 KB). On a sync server, every request in progress needs a whole worker, so each one effectively costs the worker's full memory plus its own data.

<details class="explainer">
<summary>Why do sync workers cost so much more?</summary>

It comes down to what a worker does while a request waits on the database:

- **Sync worker** (Gunicorn sync, Unicorn, PHP-FPM): one process handles one request from start to finish. While the request waits on the database, the process sits blocked and can't start anything else. Each process is a full copy of the app (interpreter, framework, libraries), so serving 50 requests at once takes 50 processes and 50 copies.
- **Async server** (Node.js, or Python on an event loop): one process juggles many requests. When one waits on the database, the process sets it aside and works on another, then comes back when the answer arrives. The app's memory is paid once per process and shared, and each extra request only adds its own data, usually a few KB.
- **Threaded server** (Java, .NET, Puma): in between. Threads share one process's memory, but each thread has its own stack of up to about 1 MB.

Think of a restaurant. A sync worker is one waiter per table who stands still while the kitchen cooks. An async server is one waiter covering many tables, taking the next order while food is cooking.

</details>

<details class="explainer">
<summary>Is FastAPI an async server?</summary>

Yes, if the code is actually async. FastAPI runs on Uvicorn, which has an event loop, but each endpoint behaves differently depending on how it's written:

| Endpoint | What happens |
| --- | --- |
| `async def` with async libraries (asyncpg, async SQLAlchemy, httpx) | Truly async: every `await` frees the process to work on other requests. |
| `async def` with blocking calls (psycopg2, `requests`, `time.sleep`) | The worst case: the blocking call freezes the event loop, so every request in that process stalls until it returns. |
| Plain `def` | Runs in a thread pool (40 threads by default), so it behaves like a threaded server. |

Requests don't get their own process or thread. Each worker process runs one event loop on one thread. A request to an `async def` endpoint becomes a lightweight task on that loop, and the loop switches between tasks at every `await`. Plain `def` endpoints borrow a thread from a reusable pool, and extra requests wait for a free one.

That's why a blocking call inside `async def` is so harmful. The loop can only switch at an `await`, so while it's stuck, nothing else in that worker process runs: not other requests to the same endpoint, not requests to completely different endpoints, not even a health check. Other worker processes have their own loops and carry on, so the damage is one whole process, not one endpoint.

You can see it with two endpoints:

```python
import time
from fastapi import FastAPI

app = FastAPI()

@app.get("/block")
async def block():
    time.sleep(5)  # blocks the event loop
    return {"done": True}

@app.get("/ping")
async def ping():
    return {"pong": True}
```

With a single worker, open `/block` and then `/ping`. `/ping` takes about 5 seconds, even though it does nothing. Any of these fixes makes it instant:

- Use `await asyncio.sleep(5)`: the `await` lets the loop serve other requests.
- Make `/block` a plain `def`: the sleep runs on a pool thread instead.
- Keep `async def` and move the call to a thread: `await asyncio.to_thread(time.sleep, 5)`.

`asyncio.to_thread` uses Python's own thread pool, which is separate from the one FastAPI uses for plain `def` endpoints. Each pool has its own limit, so busy `def` endpoints don't hold it up, and it doesn't count toward their 40-thread cap. To use the same pool and limit as `def` endpoints instead, call `await run_in_threadpool(time.sleep, 5)` from `fastapi.concurrency`. Inside a FastAPI app that's usually the more consistent choice, because all blocking work then shares one pool with one limit to tune.

A rule of thumb: if an `async def` endpoint never awaits anything, it probably shouldn't be `async def`.

Async only helps with waiting, not with CPU work. Python runs one thread of Python code at a time per process, so heavy computation blocks the event loop just like a blocking call. That's why production setups usually run one worker process per CPU core. Memory then grows with the number of workers, not the number of requests.

</details>

<details class="explainer">
<summary>How many workers, threads, and tasks?</summary>

For a FastAPI app on Uvicorn:

| Piece | How many | Limited by |
| --- | --- | --- |
| Worker processes | You choose (`--workers`); usually one per CPU core | CPU cores, since extra workers just compete for the same cores, and RAM, since each worker is a full copy of the app (often 50–150 MB) |
| Event loops | Exactly one per worker process | Fixed: one loop on one thread |
| FastAPI thread pool (plain `def` endpoints and `run_in_threadpool`) | Up to 40 threads per worker by default | A setting you can raise; past that, extra calls wait for a free thread |
| asyncio thread pool (`asyncio.to_thread`) | Up to min(32, CPU cores + 4) threads per worker | A separate pool with its own limit; past that, extra calls wait for a free thread |
| Tasks (`async def` requests in progress) | No fixed limit | Memory, open connections, downstream pools and CPU (see below) |

So a server with 4 cores typically runs 4 workers, which means 4 event loops. On top of that come up to 4 × 40 FastAPI pool threads if you use plain `def` endpoints, and up to 4 × 8 asyncio pool threads if you use `asyncio.to_thread`. Pool threads are created as needed and reused, never one per request.

Tasks are unlimited in the sense that nothing caps them by default. Each one is cheap, a few KB, so a single worker can hold thousands of requests that are all waiting on something. In practice they're limited by:

- **Memory.** Thousands of tasks are fine, but each still holds its own data. Large request bodies or results add up quickly.
- **Open connections.** Every client connection and every database connection uses a file descriptor. Many Linux systems default to 1,024 per process unless raised, and production servers usually raise it a lot.
- **Downstream pools.** Tasks can only run as many queries at once as the database connection pool allows. SQLAlchemy's async engine defaults to 5 connections plus 10 overflow, so request 16 waits inside the app for a free connection.
- **CPU.** All tasks share the one event loop thread. If each request needs 2 ms of Python CPU time, one worker tops out around 500 requests per second, however many tasks are waiting.

Because nothing caps tasks by default, an overloaded worker keeps accepting requests and everything gets slower for everyone. Uvicorn's `--limit-concurrency` option sets a cap: past it, new requests get an immediate HTTP 503 instead of joining an ever-growing pile. Failing fast like that is often better than timing out slowly.

</details>

#### Network

The server's bandwidth, in gigabits per second. Every response has to be sent over it:

$$
\text{max req/s from network} = \dfrac{\text{bandwidth (bytes per second)}}{\text{response size (bytes)}}
$$

1 Gbps is 125,000,000 bytes per second. With 40 KB responses, that's 125,000,000 / 40,000 = **3,125 requests per second**. Large responses such as images or files make network the limit quickly, which is a big reason to put a CDN in front.

Some typical response sizes, as sent over the network:

| Response | Typical size |
| --- | --- |
| Health check, or a small JSON object such as one record | **under 2 KB** |
| API list endpoint, one page of around 50 items | **5–50 KB** |
| Server-rendered HTML page | **10–100 KB** |
| Web-optimized image (JPEG or WebP) | **50–500 KB** |
| JavaScript bundle for a web app | **100 KB – 1 MB** |
| Original photo from a phone | **2–5 MB** |
| Video, streamed in chunks | **0.5–5 MB per chunk** |

Text responses like JSON and HTML are usually compressed (gzip or Brotli), which often shrinks them 3–10×, so these figures assume compression is on. The simulator's default of 40 KB is a typical mix for an app that serves API responses and pages. Images, scripts and video are normally served from a CDN or object storage rather than your app servers, which is exactly why they rarely appear in this number.

#### DB connections / worker

How many database connections each worker process keeps open. A request needs a free connection to run a query.

**Each worker has its own pool.** Workers are separate processes, and a connection belongs to the process that opened it, so one worker can't use another worker's connections. A pool is only shared by the requests inside the same worker. With 2 workers and a pool of 10, that's 2 separate pools of 10 connections each, not one pool of 10 shared by both. Sharing connections across workers takes a separate pooler process such as PgBouncer (see Setting the pool size below).

So the totals multiply:

$$
\text{connections opened} = \text{servers} \times \text{workers} \times \text{connections per worker}
$$

These count against the database's **Max connections** below. Adding servers or workers can quietly use up all of the database's connections, a common surprise when scaling out.

For both server types, connections are opened once and reused, not opened for each request. Opening one takes a few to tens of milliseconds (a network handshake, often encryption, and logging in), which can be longer than the query itself. How many a worker needs depends on the server type, and the simulator sets this to 1 for sync and 10 for async when you switch.

##### Sync workers: one connection

A sync worker handles one request at a time, and each query blocks until it returns, so it never runs more than one query at once. **One connection is enough.** The worker keeps it open and reuses it for every request; a bigger pool would only hold idle connections that still count against the database's limit.

The exceptions are a worker that uses several databases (such as a primary and a replica, one connection each), runs threads (one per thread, as with Gunicorn's `gthread` workers), or deliberately opens a second connection, for example for a separate transaction.

##### Async workers: a pool

An async worker can have several requests querying at the same moment, and a connection runs one query at a time, so it keeps a **pool**, often 5–20 connections. A request borrows a free connection, runs its queries, and gives it back, still open, for the next request. If none are free, it waits until one is returned.

Pools mostly stay open, but some connections do get closed: extras opened under heavy load (overflow) when they're returned, connections that sit idle too long, and old ones replaced on purpose, since databases and network proxies sometimes silently drop long-lived connections.

One thing to watch in FastAPI: a database session per request can hold its connection from the first query until the request ends, including time spent waiting on other things like an external API. The pool then runs dry sooner than expected. Commit or close the session as soon as the database work is done.

##### Setting the pool size

The pool size is set in your database library, for example SQLAlchemy's `pool_size` and `max_overflow`, asyncpg's `max_size`, or node-postgres's `max`. Defaults are usually 5–10 per process, and many teams read the value from an environment variable. Because every worker has its own pool, the total has to fit within the database's limit:

$$
\text{servers} \times \text{workers} \times (\text{pool size} + \text{overflow}) < \text{database max connections}
$$

PostgreSQL allows 100 connections by default, so 4 servers × 4 workers × 15 is 240, already far over. Leave some room for migrations and admin tools too. If the total grows too large, a connection pooler such as PgBouncer can sit in front of the database: workers connect to it cheaply, and it shares a much smaller set of real database connections.

### Database

The database's load is counted in **queries** per second, not requests. Each request that reaches it makes several queries (set by **DB queries / request** under Traffic):

$$
\text{database load} = (\text{reads that miss the cache} + \text{writes}) \times \text{queries per request}
$$

With 100 requests per second, no cache and 3 queries each, the database gets 100 × 3 = **300 queries per second**.

#### vCPU

The same idea as on the app server. The simulator treats each query as CPU work, so:

$$
\text{max queries/s from CPU} = \dfrac{\text{vCPU} \times 1000}{\text{query time (ms)}}
$$

2 vCPU with 4 ms queries gives 2 × 1000 / 4 = **500 queries per second**. At 3 queries per request, that's about 167 requests per second, which is why the database is the first thing to break in the One VPS scenario.

#### Query time

How long one query takes. It's used for the max queries/s from CPU above and from connections below, and for the latency each query adds. A request makes its queries one after another, so 3 queries of 4 ms add about 12 ms to every request that reaches the database.

Query times vary enormously, mostly depending on whether the database can use an index and whether the data is already in memory. Some typical values for a database like PostgreSQL:

| Query | Typical time |
| --- | --- |
| Look up one row by its primary key | **0.2–1 ms** |
| Indexed lookup returning a few rows, or a simple join | **0.5–5 ms** |
| Insert or update one row and commit it | **1–5 ms** |
| One page of results (around 50 rows) with joins and sorting | **2–20 ms** |
| Count or sum over hundreds of thousands of rows | **50–500 ms** |
| Searching a large table without a suitable index (a full table scan) | **100 ms to several seconds** |
| Reporting or analytics query over a large dataset | **seconds to minutes** |

These are the times the app actually waits for, so they include the **network round trip**: the query travelling from the app server to the database, and the result coming back. In the same data center that's about 0.1–0.5 ms, which is why even the fastest row in the table starts at 0.2 ms.

The round trip is paid on every query, one after another, so keep the database in the same region as your app servers, ideally the same data center. A database in another region adds tens of milliseconds to every query: with the app in the US and the database in Tokyo, each query pays about 150 ms, and a request with 3 queries waits about half a second on the network alone.

The simulator's default of 4 ms is a typical average for a web app whose queries use indexes. A single missing index can turn a 1 ms query into a 1-second one, which is why adding indexes is often the cheapest performance fix there is. Also watch the number of queries per request: code that runs one query per item in a list (the "N+1 queries" problem) can turn one request into hundreds of queries.

Keep in mind that the simulator counts all of the query time as database CPU. Slow queries that are mostly waiting on disk or locks use less CPU than that, but they hold their connection the whole time, so in practice they tend to run out of connections first.

#### Max connections

The most connections the database accepts at once. Only connections that servers actually open can be used, so:

$$
\text{usable connections} = \min(\text{max connections},\ \text{servers} \times \text{workers} \times \text{connections per worker})
$$

Each connection runs one query at a time, so:

$$
\text{max queries/s from connections} = \dfrac{\text{usable connections} \times 1000}{\text{query time (ms)}}
$$

With 1 server running 2 workers, each worker has its own separate pool of 10 (pools can't be shared between processes), so that's 20 connections in total, and 20 × 1000 / 4 = **5,000 queries per second**. Because this model treats query time as pure CPU time, connections only become the tighter limit when there are fewer usable connections than vCPUs. In real databases, queries also wait on disk and locks, so connections tend to run out sooner. If servers ask for more connections than the database allows, the simulator warns you, because in practice those extra connections would be refused.

#### Read replicas

Copies of the database that take over read queries. Reads are split evenly across replicas, and the primary only handles writes. The catch: every replica has to apply every write to stay in sync, so

$$
\text{load on each replica} = \dfrac{\text{reads}}{\text{replicas}} + \text{all writes}
$$

Replicas help read-heavy apps a lot, and write-heavy apps very little.

In the diagram, the line from the app server to the replicas carries only the reads the app sends. Replication doesn't go through the app: the primary streams its writes straight to each replica, shown as the dashed line between them. For example, with 270 writes per second and 2 replicas, that line carries 2 × 270 = 540 queries per second.

### What if many requests arrive at once?

The "requests in flight" figure from the RAM section isn't a gate that requests wait at. The simulator works with steady traffic and only uses it to find a per-second rate. At 100 requests per second, each in flight for 22 ms, there are on average just 100 × 0.022 ≈ **2 requests** in progress at any moment, far below the roughly 34,900 that fit in memory with the defaults.

A sudden burst, say 1,000 requests in the same instant, isn't simulated. On a real server, this is roughly what happens:

1. **The operating system queues the connections.** It keeps incoming connections in a waiting list (about 4,096 on modern Linux). Anything beyond that is refused, and the client retries or gets an error.
2. **The server picks up as many as it's set up to run at once.** That might be 4 requests for 4 Gunicorn workers, 200 for Tomcat's default thread pool, or nearly all of them for Node.js and other async servers. The rest keep waiting.
3. **Waiting is cheap.** A queued request holds a few KB, not the full memory per request, so a queue of 1,000 is fine. It just drains at the speed of the slowest component.
4. **Taking on too many at once is the real danger.** A server with no limit that starts all 1,000 at 50 MB each needs 50 GB of RAM. On a 4 GB machine, the process is killed for running out of memory, and every request in progress fails, not just the extra ones. This is why worker counts and concurrency limits matter.

With the One VPS defaults, the CPU finishes 200 requests per second and the database about 167, so a burst of 1,000 takes roughly 1,000 / 167 ≈ **6 seconds** to clear. The last requests wait about 6 seconds and the average one about 3. Meanwhile only a handful are actually being worked on at any moment, because the CPU and database are the slow part, not memory.

##### Does this happen in real life?

Exactly simultaneous is rare, but large bursts within a second or two are common:

- A push notification or marketing email goes out, and many people open the app at the same moment.
- Ticket sales or a flash sale open at a set time.
- A link gets posted somewhere popular, or the product is mentioned on TV.
- Many clients run scheduled jobs at the top of the hour.
- After an outage, every client retries at once (a "retry storm").
- A popular cache entry expires and every request that needed it goes to the database at the same time (a "cache stampede").
- A single page load fires off dozens of API calls in parallel.

For a small personal site, 1,000 at once is unlikely. For a popular app, bursts like this are routine, which is why queues, rate limits and autoscaling exist.

## Key concepts

These are the ideas behind the numbers in the metrics panel and the **Why?** panel. Click any component in the diagram to see its formulas with your numbers plugged in.

### Max sustainable and the bottleneck

Each component's load grows in step with traffic: double the requests, and the app servers, cache and database all get twice the work. So for each component, the simulator works out how much load one request puts on it (after CDN hits, cache hits and the read/write split) and divides its capacity by that:

$$
\text{max sustainable traffic for a component} = \dfrac{\text{its capacity}}{\text{its load per request}}
$$

The smallest result is **Max sustainable**, and that component is the **bottleneck**: the first one to hit 100% as traffic grows. In One VPS, the app server can handle 200 req/s, but the database can handle 500 queries/s and every request makes 3 queries, so it tops out at 500 / 3 ≈ **167 req/s**. The database is the bottleneck.

### Time here: why requests wait before 100%

**Time here** in the Why? panel is how long a request spends at one component: the work itself, plus any time spent waiting in line. Requests don't arrive evenly spaced. They arrive at random, so sometimes several land close together and have to wait for a free core, even when the component is far from full.

The simulator works this out with the standard queueing model for several servers sharing one line (M/M/c, using the Erlang C formula). Take the app server in One VPS: 100 req/s arriving at 2 cores that can handle 200 req/s between them, so it's 50% busy.

- **1 in 3** requests arrives while both cores are busy and has to wait.
- Those that wait, wait 1 / (200 − 100) s = **10 ms** on average, so the average wait across all requests is about **3.3 ms**.
- Average time here = 10 ms of CPU + 3.3 ms of waiting ≈ **13 ms**.

The **p99** is the time that 99% of requests beat. Waiting has a long tail, and the slowest 1% wait about 35 ms. The simulator also assumes their work takes twice the average, 20 ms, so the p99 is about 20 + 35 = **55 ms**.

**The exact formulas.** For a component that receives load λ and can handle at most μ (both per second), working on c requests at once:

$$
\text{average time here} = \text{work time} + \dfrac{P(\text{wait})}{\mu - \lambda}
$$

$$
\text{p99 time here} = 2 \times \text{work time} + \dfrac{\ln\big(P(\text{wait}) / 0.01\big)}{\mu - \lambda}
$$

The waiting part of the p99 is 0 when P(wait) is 1% or less. P(wait), the chance that a request has to wait at all, comes from the Erlang C formula, with $a = \lambda / (\mu / c)$:

$$
P(\text{wait}) = \dfrac{X}{\displaystyle\sum_{k=0}^{c-1} \frac{a^k}{k!} + X} \qquad \text{where} \qquad X = \dfrac{a^c}{c!} \cdot \dfrac{c}{c - a}
$$

For 2 slots, this simplifies to $a^2 / (2 + a)$. The terms mean:

- **Work time:** the component's own time per visit. That's the CPU time per request on an app server, the query time on a database, and the rated latency of the cache or load balancer.
- **c:** how many requests it can work on at once. That's the cores in use on an async app server, the workers on a sync one, the vCPUs on the database, and 1 for the single-threaded cache and the load balancer.
- **μ − λ:** the spare capacity. Dividing by it gives seconds, so multiply by 1,000 for milliseconds.
- At or above 100% (λ ≥ μ), the queue never drains, so time here is shown as the 10-second timeout.

Plugging in One VPS: a = 100 / (200 / 2) = 1, so P(wait) = 1² / (2 + 1) = 1/3. The average is 10 ms + (1/3) / 100 s = 10 + 3.3 ≈ **13 ms**, and the p99 is 20 ms + ln(33.3) / 100 s = 20 + 35 ≈ **55 ms**.

The waiting grows very quickly as a component gets busier. For the same app server:

| App server load | Average time here | p99 time here |
| --- | --- | --- |
| 50% (100 req/s) | **13 ms** | **55 ms** |
| 80% (160 req/s) | **28 ms** | **127 ms** |
| 95% (190 req/s) | **103 ms** | **473 ms** |

This is why systems feel fine right up until they don't, and why it's wise to keep components well below 100%, often under 70–80%.

### End-to-end latency

The **Latency** figures in the metrics panel add up the time at every component a request passes through. Requests take different paths: some are answered by the CDN, some by the cache, and others go all the way to the database. The average is weighted by how many requests take each path.

In One VPS, every request goes through the app server and makes 3 database queries, so the average is 13 ms + 3 × 6.3 ms ≈ **32 ms**. For the p99, the simulator adds up the p99 of each component along the path, assuming only one of the 3 queries hits its slow tail: 55 ms + 2 × 6.3 ms + 27 ms ≈ **95 ms**. Adding up p99s is a cautious estimate, since one request rarely hits the slow tail everywhere at once.

### Past 100%: errors and timeouts

When more traffic reaches a component than it can handle, the simulator lets it handle as much as its capacity allows and counts the rest as failed. That's the **Errors** figure, and **req/s succeed** shows what still gets through. The requests that do get in are stuck behind an ever-growing queue, so latency is shown as a timeout (10 seconds). Real systems behave much the same way: queues fill, requests time out, and clients start retrying, which adds even more load.

## Assumptions

This is a simplified, steady-state model for building intuition, not for exact capacity planning.

- Traffic is steady and arrives randomly (Poisson); there are no bursts, retries or autoscaling.
- Network time between components and to the client is ignored.
- Database query time is treated as CPU time, and each replica replays every write at full cost.
- The cache is single-threaded, holds 1 operation per read, and is never cold.
- The CDN has unlimited capacity, and the OS keeps 10% of each app server's RAM.
- Each worker process uses one CPU core at a time. Async workers run many requests at once; sync workers run one.
- A saturated component drops the excess; those requests count as errors, and the rest wait until a 10 s timeout.
