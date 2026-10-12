/**
 * Diagrams for the Distributed Capacity Simulator write-up.
 * See svg.mjs for the helpers and the colour/class conventions.
 */
import { box, line, marker, svg, text } from './svg.mjs';

const W = 820;

/* ---------- 1. Regions: local stacks, one home for the primaries ---------- */

export const distRegions = {
  labels: {
    en: {
      aria: 'Three regions, each with its own app servers, cache and replica; the primary database lives in region 1',
      region: (n) => `Region ${n}`,
      home: 'home',
      clients: 'Clients',
      app: 'App servers',
      cache: 'Cache',
      replica: 'Replica',
      primary: 'Primary',
      primarySub: 'all writes',
      reads: 'reads',
      writes: 'writes',
      cross: '+80 ms',
      replay: 'replays every write',
      caption:
        'Every region answers its own reads from a local cache and replica, so most requests never leave it. Writes always travel to the primary in the home region and pay the cross-region round trip, and the primary streams every write back to every replica.',
    },
    ja: {
      aria: '3つのリージョン。それぞれにアプリサーバー、キャッシュ、レプリカがあり、プライマリはリージョン1にある',
      region: (n) => `リージョン ${n}`,
      home: 'ホーム',
      clients: 'クライアント',
      app: 'アプリサーバー',
      cache: 'キャッシュ',
      replica: 'レプリカ',
      primary: 'プライマリ',
      primarySub: '全書き込み',
      reads: '読み取り',
      writes: '書き込み',
      cross: '+80 ms',
      replay: '全書き込みを反映',
      caption:
        '各リージョンは自分の読み取りをローカルのキャッシュとレプリカで返すため、ほとんどのリクエストはリージョンの外に出ません。書き込みは必ずホームリージョンのプライマリへ向かい、リージョン間の往復時間を払います。プライマリはすべての書き込みをすべてのレプリカへ送り返します。',
    },
  },
  render(l) {
    const id = 'dist-regions';
    const BAND = 120;
    const col = { clients: 20, app: 190, data: 380, primary: 600 };
    const w = { clients: 110, app: 130, data: 130, primary: 150 };
    const gapX = 555; // vertical run of the cross-region write lines
    const replX = col.primary + w.primary / 2; // vertical run of the replication lines
    const parts = [];
    const bands = [0, 1, 2];
    const primaryY = 20 + 30;
    const primaryMid = primaryY + 30;

    for (const i of bands) {
      const y = 20 + i * BAND;
      const mid = y + 60;
      const isHome = i === 0;
      parts.push(
        `<rect x="10" y="${y}" width="${W - 20}" height="${BAND - 8}" rx="10" class="d-band" />`,
        text(22, y + 14, isHome ? [{ t: l.region(i + 1) }, { t: ` · ${l.home}`, cls: 'd-primary-text' }] : l.region(i + 1), 'd-band-label'),
        box(col.clients, y + 30, w.clients, 60, { title: l.clients }),
        box(col.app, y + 30, w.app, 60, { title: l.app }),
        box(col.data, y + 10, w.data, 40, { title: l.cache }),
        box(col.data, y + 75, w.data, 40, { title: l.replica }),
        line(col.clients + w.clients, mid, col.app, mid, { cls: 'primary', markerId: `${id}-p` }),
        line(col.app + w.app, mid, col.data, y + 30, { markerId: `${id}-m` }),
        line(col.app + w.app, mid, col.data, y + 95, { cls: 'secondary', markerId: `${id}-s` }),
        text(col.data - 6, y + 112, l.reads, 'd-secondary-text', 'text-anchor="end"'),
      );
      if (isHome) {
        parts.push(
          line(col.app + w.app, mid, col.primary, mid - 8, { cls: 'pink', markerId: `${id}-k` }),
          text(gapX - 20, mid - 12, l.writes, 'd-pink', 'text-anchor="middle"'),
        );
      } else {
        // Right through the gap between cache and replica, up the gutter, into the primary
        parts.push(
          `<path d="M${col.app + w.app} ${mid} H${gapX} V${primaryMid - 8 + i * 8}" class="d-line pink d-dashed" />`,
          text(gapX + 10, mid - 10, [{ t: `${l.writes} ${l.cross}` }], 'd-pink'),
        );
      }
      // Replication back to this region's replica: down the primary column, then left
      const replicaMid = y + 95;
      parts.push(
        `<path d="M${replX} ${primaryY + 60} V${replicaMid} H${col.data + w.data + 2}" class="d-line d-dashed" marker-end="url(#${id}-m)" />`,
      );
    }
    // Primary, drawn last so the lines run under its box
    parts.push(
      `<path d="M${gapX} ${primaryMid} H${col.primary}" class="d-line pink d-dashed" marker-end="url(#${id}-k)" />`,
      `<path d="M${gapX} ${primaryMid + 8} H${col.primary}" class="d-line pink d-dashed" marker-end="url(#${id}-k)" />`,
      box(col.primary, primaryY, w.primary, 60, { title: l.primary, sub: l.primarySub, cls: 'd-box-owner' }),
      text(replX + 8, 20 + BAND * 2 + 75, l.replay, 'd-muted'),
    );
    const H = 20 + BAND * 3;
    return {
      svg: svg(W, H, parts.join(''), {
        label: l.aria,
        defs: marker(`${id}-p`, 'primary') + marker(`${id}-s`, 'secondary') + marker(`${id}-k`, 'pink') + marker(`${id}-m`),
      }),
      caption: l.caption,
    };
  },
};

/* ---------- 2. The retry loop ---------- */

export const distRetryLoop = {
  labels: {
    en: {
      aria: 'Retries feed failed requests back into the traffic, so attempts grow until the loop settles',
      clients: 'Clients',
      clientsSub: '1,300 req/s',
      system: 'App tier',
      systemSub: 'capacity 1,200 req/s',
      attempts: '2,535 attempts/s',
      ok: '1,200 req/s succeed',
      fail: '1,335 attempts/s fail',
      retry: 'each retried up to 3×: +1,235 req/s',
      caption:
        'In the Retry storm scenario, 1,300 req/s of real traffic becomes 2,535 attempts per second: every failure is sent again, fails again, and is sent again. The app tier still completes exactly its 1,200 req/s, so the extra load buys nothing.',
    },
    ja: {
      aria: 'リトライが失敗したリクエストをトラフィックに戻すため、ループが落ち着くまで試行数が増える',
      clients: 'クライアント',
      clientsSub: '1,300 req/s',
      system: 'アプリ層',
      systemSub: '処理能力 1,200 req/s',
      attempts: '2,535 試行/s',
      ok: '1,200 req/s が成功',
      fail: '1,335 試行/s が失敗',
      retry: 'それぞれ最大3回リトライ：+1,235 req/s',
      caption:
        'リトライストームのシナリオでは、1,300 req/s の実トラフィックが毎秒 2,535 回の試行になります。失敗したものは再送され、また失敗し、また再送されます。アプリ層が完了できるのは相変わらず 1,200 req/s ちょうどなので、増えた負荷は何も生みません。',
    },
  },
  render(l) {
    const id = 'dist-retry';
    const parts = [
      box(40, 40, 170, 64, { title: l.clients, sub: l.clientsSub }),
      box(330, 40, 190, 64, { title: l.system, sub: l.systemSub }),
      box(620, 40, 180, 64, { title: l.ok, cls: 'd-box-ok' }),
      line(210, 72, 330, 72, { cls: 'primary', markerId: `${id}-p` }),
      text(270, 62, l.attempts, 'd-primary-text', 'text-anchor="middle"'),
      line(520, 72, 620, 72, { cls: 'primary', markerId: `${id}-p` }),
      // Failures loop back under the boxes
      `<path d="M425 104 V150 H125 V104" class="d-line pink" marker-end="url(#${id}-k)" />`,
      text(440, 135, l.fail, 'd-pink'),
      text(275, 170, l.retry, 'd-pink', 'text-anchor="middle"'),
    ];
    return {
      svg: svg(W, 190, parts.join(''), { label: l.aria, defs: marker(`${id}-p`, 'primary') + marker(`${id}-k`, 'pink') }),
      caption: l.caption,
    };
  },
};
