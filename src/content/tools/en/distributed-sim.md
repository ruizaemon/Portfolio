---
title: Distributed Capacity Simulator
description: Part 2 of the capacity simulator. Spread the stack over several regions, shard the database, add a connection pooler, and see what retries and load shedding do once something is over capacity.
image: /tools/distributed-sim/thumb.svg
lang: en
order: 2
updatedDate: 2026-10-12
tags: ['System Design', 'Visualization', 'Vue 3', 'TypeScript']
component: distributed-sim
---

<nav class="toc" aria-label="On this page">

**On this page**

- [How this builds on part 1](#how-this-builds-on-part-1)
- [Regions](#regions)
  - [Traffic split and region loss](#traffic-split-and-region-loss)
  - [Writes have a home](#writes-have-a-home)
  - [Replication fan-out](#replication-fan-out)
  - [Planning for N+1](#planning-for-n1)
- [Sharding](#sharding)
  - [Hot shards](#hot-shards)
- [Connection pooler](#connection-pooler)
- [Retries](#retries)
  - [Retry storms](#retry-storms)
  - [Retry budgets](#retry-budgets)
- [Load shedding](#load-shedding)
- [Assumptions](#assumptions)

</nav>

This is part 2 of the [System Capacity Simulator](/en/projects/tools/capacity-sim). Part 1 explains the components inside one region (CDN, load balancer, app servers, cache, database and replicas), what limits each of them, and how queueing turns load into latency. This page assumes all of that and only explains what's new: running several copies of that stack, splitting the database, and what clients do when requests fail.

## How this builds on part 1

Every region here runs a copy of part 1's **Read replicas** scenario, with the database upgraded to 4 vCPU so that the app tier is the first limit: 6 async servers with 2 vCPU each, 10 ms of CPU per request, 3 queries per request at 4 ms each, a cache answering 85% of reads, and 2 read replicas per shard. One region can take 6 × 2 × 1000 / 10 = **1,200 req/s** before the app servers' CPU saturates. Every number on this page comes from that stack.

The engine reuses part 1's rules unchanged. Part 1 works out what each component can do per instance, and this simulator only decides how the load is routed between the copies: how much traffic each region gets, which database a query goes to, and how many attempts a request turns into. Clicking a component shows the same formulas as before, with the regions and shards filled in.

## Regions

A region is a data center location, such as AWS `us-east-1` or Google Cloud `asia-northeast1`. Running in several regions puts servers closer to users, and keeps the service up when one location fails. In the simulator, every region has its own load balancer, app servers, cache and replicas, drawn as one band of the diagram each.

### Traffic split and region loss

Global traffic is split evenly between the regions that are up, as a geo-aware DNS or a global load balancer would do. **Click a region** in the diagram or the control panel to take it down: its share of the traffic moves to the others, which is exactly what failover does, and exactly where capacity planning goes wrong.

In the **Region loss** scenario, 2,700 req/s are spread over 3 regions, so each takes 900 req/s and runs at a comfortable 75%. With region 3 down, the other two get 1,350 req/s each, 112% of what they can take. The app servers saturate, 11% of requests fail and the rest time out. The regions were sized for the traffic, but not for the traffic *plus a failure*.

### Writes have a home

Reads can be served by any replica, but every write has to go through the one primary, otherwise two regions could change the same row at the same time and disagree about the result. So the primaries live in one region, the **home** region, and writes from every other region cross to it. The simulator charges the **cross-region round trip** (80 ms by default) on every query that leaves its region, and since the 3 queries of a request run one after the other, a write request from a remote region pays it 3 times.

<div data-diagram="dist-regions"></div>

Reads stay local as long as each region has replicas. Without them, every cache miss crosses to the primary too. The **Cross-region reads** scenario shows this: the home region answers in 17 ms, the two remote regions in 74 ms, because 23.5% of their requests miss the cache and make 3 × 80 ms of round trips. Add one replica per region and the remote regions drop back to local latency.

If the home region goes down, the simulator **fails over**: the primaries are promoted in the next live region, and the writes from everywhere else now cross to that one. Real databases do the same thing, though it takes a minute or more and the standby has to be in sync first.

### Replication fan-out

Each replica replays every write to stay in sync, which part 1 already models: a replica's load is its share of the reads plus *all* the writes. With several regions, that cost stops being a detail. The writes from every region land on the primary and then on every replica in every region, so adding a region adds read capacity but no write capacity at all.

With the default stack in one region, the limit is the app tier at 1,200 req/s. Run 3 regions and you might expect 3,600, but the simulator reports **2,721 req/s**, limited by the replicas. At 1 global req/s, each replica gets (1/3 × 0.405 / 2) reads and 0.3 replayed writes, 0.3675 queries in total, and 1,000 / 0.3675 = 2,721. The read share got smaller with every region, the write share did not. More regions push the bottleneck onto replication, and the fix is either fewer writes (batching, caching) or a database that's sharded, which is the next section.

### Planning for N+1

The **If a region is lost** metric in the panel answers the capacity-planning question directly: with one more region down, what's the most traffic the rest can take, and does today's traffic still fit? Sizing each region so that the others can absorb its share is called **N+1** capacity. It means paying for about one region's worth of servers that sit at low utilization most of the time, which is why 3 regions at 67% are safer than 2 regions at 50%: losing one of three leaves the others at 100%, losing one of two leaves the other at 100% too, but the three-region setup wastes less. With 4 regions at 75%, losing one puts the rest exactly at 100%; more regions cost less headroom each.

## Sharding

Replicas scale reads. **Sharding** scales writes, and storage: the rows are split across several independent databases, each with its own primary and replicas, by some key such as the user ID or the tenant. Each query goes to exactly one shard, so with 4 shards every primary sees a quarter of the writes and holds a quarter of the data. The app (or a routing layer in front of the databases) has to know which shard holds which key, and queries that span shards, such as "all orders today" across every user, become expensive, which is why sharding is usually the last step rather than the first.

In the simulator, the **Shards** slider splits the database tier. Each shard gets the primary and replicas described by the stack settings, so 4 shards with 2 replicas means 4 primaries in the home region and 8 replicas in every region. The diagram shows one box per tier, standing for the busiest shard, with the shard count on it.

### Hot shards

Splitting by key only helps if the keys are busy evenly. If one tenant generates most of the traffic, or one celebrity's posts get most of the reads, its shard is a **hot shard**: it saturates while the others sit idle, and the system's capacity is whatever that one shard can do. The **Hottest shard's share** slider sets how much of the query load lands on the busiest shard, from an even split up to all of it.

The **Hot shard** scenario has 4 shards but sends 70% of the queries to one of them. At 2,000 req/s, its replica runs at 99% while the other three sit at 14%, and the system is limited at 2,026 req/s. With an even 25% each, the same 4 shards would take 5,674 req/s. Choosing the shard key is mostly about avoiding this: hashing the key spreads it evenly, but makes range queries impossible; splitting by tenant keeps a tenant's data together, but puts the largest tenant on one shard.

Sharding also multiplies **connections**: every worker process keeps a pool to every shard, so the connection count from part 1 (servers × workers × pool size) is per shard, and it grows again with every region, since every region's servers connect to the primaries. The simulator warns when the primaries would see more connections than they allow, and the next section is the usual fix.

## Connection pooler

A **connection pooler** such as PgBouncer or ProxySQL sits between the app servers and a database. The workers connect to the pooler, which is cheap, and the pooler keeps a small, fixed pool of real connections to the database, handing each query a free one and queueing it briefly when none is free. A database connection is a process or thread with its own memory, so a Postgres server with 500 connections open is doing real work just to keep them, while 20 to 50 connections are enough to keep its CPUs busy.

In the simulator, turning the pooler on adds a **Pooler** box to each region, and moves the connection limit from the databases onto it: a pool of 20 connections to a database with 4 ms queries can carry 20 × 1000 / 4 = 5,000 queries/s, and the databases are then limited by their CPU alone. The connection warning disappears, because the pooler is what opens connections to the primaries now, not the workers. The queueing inside the pooler is modelled the same way as everywhere else, so a pool that's too small shows up as waiting time in the pooler's details.

## Retries

When a request fails, the client usually tries again. Browsers, mobile apps, SDKs and service meshes all do it, often several times, and it's the right thing to do for a brief glitch: a dropped packet, a server that was restarting. The trouble starts when the failure is caused by load.

### Retry storms

If a component is saturated, every failed request that comes back as a retry is one more request for the same saturated component. The failures cause retries, the retries cause more failures, and the loop only settles when the attempt rate has grown enough that the extra load is all being rejected. This is a **retry storm**, and it's how a small overload becomes a large outage.

<div data-diagram="dist-retry-loop"></div>

The **Retry storm** scenario sends 1,300 req/s to an app tier that can take 1,200, and lets clients retry each failure 3 times. Without retries, 100 req/s would fail. With them, the loop settles at **2,535 attempts/s**, with 1,335 of them failing, and the app tier runs at 211% of its capacity. The number of requests that succeed is exactly the same 1,200 req/s, because that's all the servers can do, so the error rate is the same 7.7% as without retries. The retries made the overload twice as bad and helped nobody. The simulator solves this loop directly: the attempt rate is the fixed point where real traffic plus the retries of the failed share equals the attempts.

### Retry budgets

Retries are fine as long as they stay rare. Two habits keep them that way, and both are in every serious client library:

- **Exponential backoff with jitter:** wait longer before each retry (say 100 ms, 200 ms, 400 ms) plus a random amount, so a burst of failures doesn't come back as a burst of retries at the same instant. This spreads the load in time but doesn't bound it.
- **A retry budget:** allow retries only up to some share of the real traffic, 10% is the common figure, and give up beyond that. This bounds it. Google's SRE book describes per-client budgets; Envoy and Finagle implement them.

The **Retry budget** switch caps retries at 10% of the real traffic. In the same overload, attempts stay at 1,430 req/s instead of 2,535, and the servers run at 119% instead of 211%, which is bad but not spiralling. The simulator keeps retries on by default with the budget on, which is the setting you want in production.

## Load shedding

A saturated component makes everyone wait: queues grow until requests time out, and a timed-out request still consumed the resources it waited for. **Load shedding** rejects the excess *before* it queues, with a fast error such as HTTP 503 or 429, so that the requests it does accept are served quickly. It's done at the load balancer or in the app with a concurrency limit, a rate limit, or adaptive limits that watch latency.

The **Load shedding** switch makes each region's load balancer admit only up to the threshold (80% by default) of the region's share of the system's capacity and reject the rest at once. In the **Load shedding** scenario, the same 1,300 req/s overload turns into 960 req/s admitted and 470 req/s rejected, including the budgeted retries. 26% of requests fail, which is worse than the 7.7% of the retry storm, but the ones that get in finish in 32 ms on average instead of timing out after 10 seconds, and the servers run at 80%. That's the trade: fewer, faster failures, and a system that keeps working for most users instead of for none. Rejected requests still get retried, which is why shedding and retry budgets go together, and why a 503 should carry a `Retry-After` header.

## Assumptions

On top of part 1's assumptions:

- Traffic is split evenly between live regions, and a down region's traffic moves to the others instantly.
- Every region runs an identical stack. The primaries are in the lowest-numbered live region, and failover is instant and complete.
- Reads go to the local replicas; without replicas, to the primary. Writes always go to the primary. Every query that leaves its region adds one cross-region round trip, and a request's queries run one after the other.
- Every replica replays every write at full cost, in every region.
- Shards are independent; the busiest shard gets the configured share of all queries, and the others split the rest evenly.
- The pooler adds 0.2 ms per query and queues queries for a free connection; it's never a CPU limit itself.
- Retries are immediate and independent: a retried attempt fails with the same probability as any other. A budget caps retries at 10% of the real traffic.
- Load shedding rejects at the load balancer, based on the region's share of the system's maximum, and rejected requests cost nothing.
