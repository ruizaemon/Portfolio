/**
 * Registry of write-up and blog diagrams, keyed by the name used in markdown:
 *
 *   <div data-diagram="lb-request-flow"></div>
 *
 * rehypeDiagrams swaps that placeholder for the rendered SVG in the page's language.
 */
import { lbRequestFlow, lbLayer4Nat, lbLayersCompared, proxyVsReverse } from './load-balancer.mjs';
import { distRegions, distRetryLoop } from './distributed.mjs';
import {
  netStackOwnership, netFourTuple, netTcpHandshake, netByteStream, netTcpRetransmit, netWindows, netTcpClose,
  netTlsHandshake, netCertChain, netFraming, netFirstByte, netHttpVersions, netServerPath,
} from './networking.mjs';

export const diagrams = {
  'lb-request-flow': lbRequestFlow,
  'lb-layer4-nat': lbLayer4Nat,
  'lb-layers-compared': lbLayersCompared,
  'proxy-vs-reverse': proxyVsReverse,
  'dist-regions': distRegions,
  'dist-retry-loop': distRetryLoop,
  // Blog: how an HTTPS request really works
  'net-stack-ownership': netStackOwnership,
  'net-four-tuple': netFourTuple,
  'net-tcp-handshake': netTcpHandshake,
  'net-byte-stream': netByteStream,
  'net-tcp-retransmit': netTcpRetransmit,
  'net-windows': netWindows,
  'net-tcp-close': netTcpClose,
  'net-tls-handshake': netTlsHandshake,
  'net-cert-chain': netCertChain,
  'net-framing': netFraming,
  'net-first-byte': netFirstByte,
  'net-http-versions': netHttpVersions,
  'net-server-path': netServerPath,
};
