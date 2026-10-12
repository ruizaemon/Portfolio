/**
 * Diagrams for the load balancer section of the capacity simulator write-up.
 * Each export is { labels: { en, ja }, render(labels) -> { svg, caption } }.
 */
import { box, card, line, marker, svg, text } from './svg.mjs';

const W = 820;
// Three boxes in a row: client, load balancer, app server
const COL = { client: 20, lb: 320, app: 650, w: 150, lbW: 180 };
const MID = { c1: 245, lb: 410, c2: 575 }; // centres of gap 1, the LB box, gap 2
const CARD = { x1: 102, x2: 417, w: 300 };

/* ---------- 1. One request through a layer 7 load balancer ---------- */

export const lbRequestFlow = {
  labels: {
    en: {
      aria: 'One request through a layer 7 load balancer: two separate connections',
      client: 'Browser',
      clientSub: '203.0.113.7',
      lb: 'Load balancer',
      lbSub: '198.51.100.10 / 10.0.0.5',
      app: 'App server',
      appSub: '10.0.1.20',
      conn1: 'connection 1',
      conn2: 'connection 2',
      card1: 'Browser ↔ load balancer',
      card2: 'Load balancer ↔ app server',
      tlsYes: 'encrypted with your certificate',
      tlsNo: 'none, plain HTTP',
      ends: ['both connections end here:', 'the request is read, then written again'],
      caption:
        'A layer 7 load balancer ends the browser’s connection and opens its own to the app server. Highlighted fields are new: the app server sees the load balancer as the client, so the real IP travels in a header.',
    },
    ja: {
      aria: 'レイヤー7ロードバランサーを通る1つのリクエスト：独立した2本の接続',
      client: 'ブラウザ',
      clientSub: '203.0.113.7',
      lb: 'ロードバランサー',
      lbSub: '198.51.100.10 / 10.0.0.5',
      app: 'アプリサーバー',
      appSub: '10.0.1.20',
      conn1: '接続1',
      conn2: '接続2',
      card1: 'ブラウザ ↔ ロードバランサー',
      card2: 'ロードバランサー ↔ アプリサーバー',
      tlsYes: '自分の証明書で暗号化',
      tlsNo: 'なし（平文のHTTP）',
      ends: ['どちらの接続もここで終わり、', 'リクエストは読み取られて書き直される'],
      caption:
        'レイヤー7のロードバランサーはブラウザとの接続をそこで終わらせ、アプリサーバーへ自前の接続を開きます。強調した項目は新しく作られたもので、アプリサーバーからはロードバランサーがクライアントに見えるため、本当のIPはヘッダーで運ばれます。',
    },
  },
  render(l) {
    const id = 'lb-flow';
    const parts = [
      box(COL.client, 20, COL.w, 60, { title: l.client, sub: l.clientSub }),
      box(COL.lb, 20, COL.lbW, 60, { title: l.lb, sub: l.lbSub }),
      box(COL.app, 20, COL.w, 60, { title: l.app, sub: l.appSub }),
      line(COL.client + COL.w, 50, COL.lb, 50, { cls: 'primary', start: true, markerId: `${id}-p` }),
      line(COL.lb + COL.lbW, 50, COL.app, 50, { cls: 'secondary', start: true, markerId: `${id}-s` }),
      text(MID.c1, 42, l.conn1, 'd-primary-text', 'text-anchor="middle"'),
      text(MID.c2, 42, l.conn2, 'd-secondary-text', 'text-anchor="middle"'),
    ];
    const c1 = card(CARD.x1, 100, CARD.w, l.card1, [
      { label: 'IP', value: '203.0.113.7 → 198.51.100.10' },
      { label: 'TCP', value: '51234 → 443' },
      { label: 'TLS', value: l.tlsYes },
      { label: 'HTTP', value: 'GET /api/orders' },
      { label: '', value: '' },
    ], { titleCls: 'd-primary-text' });
    const c2 = card(CARD.x2, 100, CARD.w, l.card2, [
      { label: 'IP', value: [{ t: '10.0.0.5 → 10.0.1.20', cls: 'd-pink' }] },
      { label: 'TCP', value: [{ t: '40112 → 8000', cls: 'd-pink' }] },
      { label: 'TLS', value: l.tlsNo },
      { label: 'HTTP', value: 'GET /api/orders' },
      { label: '', value: [{ t: 'X-Forwarded-For: 203.0.113.7', cls: 'd-pink' }] },
    ], { titleCls: 'd-secondary-text' });
    parts.push(c1.svg, c2.svg);
    const bottom = 100 + c1.h;
    parts.push(
      line(MID.lb, 80, MID.lb, bottom + 16, { dashed: true, end: false }),
      text(MID.lb, bottom + 34, l.ends[0], 'd-muted', 'text-anchor="middle"'),
      text(MID.lb, bottom + 50, l.ends[1], 'd-muted', 'text-anchor="middle"'),
    );
    const H = bottom + 62;
    return {
      svg: svg(W, H, parts.join(''), { label: l.aria, defs: marker(`${id}-p`, 'primary') + marker(`${id}-s`, 'secondary') }),
      caption: l.caption,
    };
  },
};

/* ---------- 2. A layer 4 load balancer rewriting addresses ---------- */

export const lbLayer4Nat = {
  labels: {
    en: {
      aria: 'A layer 4 load balancer rewriting the destination of each packet and the source of each reply',
      client: 'Browser',
      clientSub: '203.0.113.7',
      lb: 'Layer 4 load balancer',
      lbSub: '198.51.100.10',
      app: 'App server',
      appSub: '10.0.1.20',
      request: 'request',
      reply: 'reply',
      card1: 'Between browser and load balancer',
      card2: 'Between load balancer and app server',
      req: 'req',
      rep: 'reply',
      flow: 'Flow table: the only state it keeps',
      flowRow: '203.0.113.7:51234 → :443   ⇒  10.0.1.20',
      caption:
        'One TCP connection runs from the browser to the app server. The load balancer only rewrites the highlighted addresses: the destination on the way in, and the source on the way back, so the browser sees replies from the address it connected to.',
    },
    ja: {
      aria: '各パケットの宛先と各応答の送信元を書き換えるレイヤー4ロードバランサー',
      client: 'ブラウザ',
      clientSub: '203.0.113.7',
      lb: 'レイヤー4ロードバランサー',
      lbSub: '198.51.100.10',
      app: 'アプリサーバー',
      appSub: '10.0.1.20',
      request: 'リクエスト',
      reply: '応答',
      card1: 'ブラウザ〜ロードバランサー間',
      card2: 'ロードバランサー〜アプリサーバー間',
      req: '往路',
      rep: '復路',
      flow: 'フローテーブル：唯一の状態',
      flowRow: '203.0.113.7:51234 → :443   ⇒  10.0.1.20',
      caption:
        'TCP接続はブラウザからアプリサーバーまで1本だけです。ロードバランサーは強調したアドレスだけを書き換えます。行きは宛先、帰りは送信元を書き換えるので、ブラウザには接続した先のアドレスから応答が返ってきたように見えます。',
    },
  },
  render(l) {
    const id = 'lb-l4';
    const m = `${id}-a`;
    const parts = [
      box(COL.client, 20, COL.w, 60, { title: l.client, sub: l.clientSub }),
      box(COL.lb, 20, COL.lbW, 60, { title: l.lb, sub: l.lbSub }),
      box(COL.app, 20, COL.w, 60, { title: l.app, sub: l.appSub }),
      // Request row, left to right, straight through
      line(COL.client + COL.w, 40, COL.lb, 40, { cls: 'primary', markerId: m }),
      line(COL.lb + COL.lbW, 40, COL.app, 40, { cls: 'primary', markerId: m }),
      text(MID.c1, 33, l.request, 'd-muted', 'text-anchor="middle"'),
      // Reply row, right to left
      line(COL.app, 64, COL.lb + COL.lbW, 64, { markerId: `${id}-m` }),
      line(COL.lb, 64, COL.client + COL.w, 64, { markerId: `${id}-m` }),
      text(MID.c2, 78, l.reply, 'd-muted', 'text-anchor="middle"'),
    ];
    const c1 = card(CARD.x1, 100, CARD.w, l.card1, [
      { label: l.req, value: 'src 203.0.113.7:51234' },
      { label: '', value: 'dst 198.51.100.10:443' },
      { label: l.rep, value: [{ t: 'src 198.51.100.10:443', cls: 'd-pink' }] },
      { label: '', value: 'dst 203.0.113.7:51234' },
    ]);
    const c2 = card(CARD.x2, 100, CARD.w, l.card2, [
      { label: l.req, value: 'src 203.0.113.7:51234' },
      { label: '', value: [{ t: 'dst 10.0.1.20:443', cls: 'd-pink' }] },
      { label: l.rep, value: 'src 10.0.1.20:443' },
      { label: '', value: 'dst 203.0.113.7:51234' },
    ]);
    parts.push(c1.svg, c2.svg);
    const flowY = 100 + c1.h + 22;
    const flow = card(MID.lb - 170, flowY, 340, l.flow, [{ label: '', value: l.flowRow }], { labelW: 0 });
    parts.push(
      line(MID.lb, 80, MID.lb, flowY, { dashed: true, end: false }),
      flow.svg,
    );
    const H = flowY + flow.h + 16;
    return {
      svg: svg(W, H, parts.join(''), { label: l.aria, defs: marker(m, 'primary') + marker(`${id}-m`) }),
      caption: l.caption,
    };
  },
};

/* ---------- 3. Which layers each device touches ---------- */

export const lbLayersCompared = {
  labels: {
    en: {
      aria: 'What a router, a layer 4 load balancer and a layer 7 load balancer each do to layers 2, 3, 4 and 7',
      cols: ['Router', 'Layer 4 load balancer', 'Layer 7 load balancer'],
      rows: ['Layer 7 · HTTP', 'Layer 4 · TCP ports', 'Layer 3 · IP addresses', 'Layer 2 · Ethernet'],
      cells: [
        // Router
        [['pass', 'not looked at'], ['pass', 'not looked at'], ['read', 'read, left untouched'], ['hop', 'replaced, like every hop']],
        // Layer 4 LB
        [['pass', 'not looked at'], ['read', 'read, flow tracked'], ['rewrite', 'dst rewritten, reply src too'], ['hop', 'replaced, like every hop']],
        // Layer 7 LB
        [['end', 'read, new request written'], ['end', 'ends here, new connection'], ['end', 'ends here, new header'], ['hop', 'replaced, like every hop']],
      ],
      legend: [['pass', 'passes through'], ['read', 'read only'], ['rewrite', 'rewritten'], ['end', 'ends here, re-created']],
      caption: 'The higher a device works, the more of each packet it replaces. A router keeps everything above layer 2. A layer 7 load balancer keeps nothing: every layer on the far side is new.',
    },
    ja: {
      aria: 'ルーター、レイヤー4ロードバランサー、レイヤー7ロードバランサーがレイヤー2、3、4、7に対してそれぞれ行うこと',
      cols: ['ルーター', 'レイヤー4ロードバランサー', 'レイヤー7ロードバランサー'],
      rows: ['レイヤー7 · HTTP', 'レイヤー4 · TCPポート', 'レイヤー3 · IPアドレス', 'レイヤー2 · Ethernet'],
      cells: [
        [['pass', '見ない'], ['pass', '見ない'], ['read', '読むだけ、変更なし'], ['hop', 'ホップごとに付け替え']],
        [['pass', '見ない'], ['read', '読んでフローを記録'], ['rewrite', '宛先と応答の送信元を書き換え'], ['hop', 'ホップごとに付け替え']],
        [['end', '読んで新しいリクエストを作成'], ['end', 'ここで終了、新しい接続'], ['end', 'ここで終了、新しいヘッダー'], ['hop', 'ホップごとに付け替え']],
      ],
      legend: [['pass', '素通り'], ['read', '読むだけ'], ['rewrite', '書き換え'], ['end', 'ここで終了・作り直し']],
      caption: '上の層で働く機器ほど、パケットの多くを置き換えます。ルーターはレイヤー2より上をそのまま残し、レイヤー7のロードバランサーは何も残しません。向こう側ではすべての層が新しいものです。',
    },
  },
  render(l) {
    const labelW = 170;
    const colW = 200;
    const colX = [200, 410, 620];
    const rowH = 36;
    const rowY = [58, 98, 138, 178];
    const parts = [];
    l.cols.forEach((c, i) => parts.push(text(colX[i] + colW / 2, 36, c, 'd-title', 'text-anchor="middle"')));
    l.rows.forEach((r, i) => parts.push(text(20, rowY[i] + rowH / 2 + 4, r, 'd-text')));
    l.cells.forEach((col, ci) => {
      col.forEach(([state, label], ri) => {
        parts.push(
          `<rect x="${colX[ci]}" y="${rowY[ri]}" width="${colW}" height="${rowH}" rx="6" class="d-cell d-cell-${state}" />`,
          text(colX[ci] + colW / 2, rowY[ri] + rowH / 2 + 4, label, 'd-cell-text', 'text-anchor="middle"'),
        );
      });
    });
    // Legend
    let lx = 200;
    const ly = 238;
    l.legend.forEach(([state, label]) => {
      parts.push(
        `<rect x="${lx}" y="${ly - 10}" width="14" height="14" rx="3" class="d-cell d-cell-${state}" />`,
        text(lx + 20, ly + 1, label, 'd-muted'),
      );
      lx += 24 + label.length * (/[^\x00-\x7f]/.test(label) ? 11.5 : 6.8) + 22;
    });
    void labelW;
    return { svg: svg(W, 256, parts.join(''), { label: l.aria }), caption: l.caption };
  },
};

/* ---------- 4. Forward proxy vs reverse proxy ---------- */

export const proxyVsReverse = {
  labels: {
    en: {
      aria: 'A forward proxy in front of many clients, and a reverse proxy in front of many servers',
      left: 'Forward proxy: works for the clients',
      right: 'Reverse proxy: works for the servers',
      client: 'client',
      proxy: 'forward proxy',
      anyServer: 'any website',
      anyUser: 'any user',
      rproxy: 'reverse proxy',
      server: 'app server',
      leftNote: 'websites see one address: the proxy’s',
      rightNote: 'users see one address: the proxy’s',
      caption: 'Same mechanism, opposite owner. The highlighted side is the one that set the proxy up; the other side never learns what is behind it.',
    },
    ja: {
      aria: '多数のクライアントの前に置かれたフォワードプロキシと、多数のサーバーの前に置かれたリバースプロキシ',
      left: 'フォワードプロキシ：クライアントのために働く',
      right: 'リバースプロキシ：サーバーのために働く',
      client: 'クライアント',
      proxy: 'フォワードプロキシ',
      anyServer: '任意のWebサイト',
      anyUser: '任意のユーザー',
      rproxy: 'リバースプロキシ',
      server: 'アプリサーバー',
      leftNote: 'Webサイトから見えるのはプロキシのアドレスだけ',
      rightNote: 'ユーザーから見えるのはプロキシのアドレスだけ',
      caption: '仕組みは同じで、持ち主が逆です。強調した側がプロキシを用意した側で、反対側はその裏に何があるかを知りません。',
    },
  },
  render(l) {
    const id = 'lb-proxy';
    const m = `${id}-a`;
    const parts = [];
    const stackY = [48, 88, 128];
    const fan = [95, 103, 111]; // where the three lines meet the proxy, so arrowheads don't pile up
    // Left panel
    parts.push(text(20, 24, l.left, 'd-title'));
    stackY.forEach((y, i) => {
      parts.push(box(20, y, 100, 30, { title: l.client, cls: 'd-box d-box-owner' }));
      parts.push(line(120, y + 15, 155, fan[i], { markerId: m }));
    });
    parts.push(box(155, 78, 130, 50, { title: l.proxy }));
    parts.push(line(285, 103, 300, 103, { markerId: m }));
    parts.push(box(300, 78, 110, 50, { title: l.anyServer }));
    parts.push(text(215, 184, l.leftNote, 'd-muted', 'text-anchor="middle"'));
    // Right panel
    const ox = 425;
    parts.push(text(ox, 24, l.right, 'd-title'));
    parts.push(box(ox, 78, 110, 50, { title: l.anyUser }));
    parts.push(line(ox + 110, 103, ox + 125, 103, { markerId: m }));
    parts.push(box(ox + 125, 78, 130, 50, { title: l.rproxy }));
    stackY.forEach((y, i) => {
      parts.push(line(ox + 255, fan[i], ox + 285, y + 15, { markerId: m }));
      parts.push(box(ox + 285, y, 100, 30, { title: l.server, cls: 'd-box d-box-owner' }));
    });
    parts.push(text(ox + 192, 184, l.rightNote, 'd-muted', 'text-anchor="middle"'));
    // Divider between panels
    parts.push(line(W / 2, 14, W / 2, 190, { end: false, dashed: true }));
    return { svg: svg(W, 200, parts.join(''), { label: l.aria, defs: marker(m) }), caption: l.caption };
  },
};
