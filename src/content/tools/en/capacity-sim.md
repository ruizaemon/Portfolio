---
title: System Capacity Simulator
description: Build a simple architecture — servers, load balancer, cache, database, replicas — tune the hardware and traffic, and see where it breaks.
image: /tools/capacity-sim/thumb.svg
lang: en
order: 1
inProgress: true
tags: ['System Design', 'Visualization', 'Vue 3', 'TypeScript']
component: capacity-sim
---

## How it works

Each component has a capacity limited by its resources — CPU, memory, network, or connections. The simulator works out how much traffic reaches each component (after CDN offload, cache hits, and read/write splits), how busy that makes it, and how latency grows as it approaches saturation.

## Assumptions

This is a simplified, steady-state model meant for building intuition, not for exact capacity planning.
