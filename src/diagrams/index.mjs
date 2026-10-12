/**
 * Registry of write-up diagrams, keyed by the name used in markdown:
 *
 *   <div data-diagram="lb-request-flow"></div>
 *
 * rehypeDiagrams swaps that placeholder for the rendered SVG in the page's language.
 */
import { lbRequestFlow, lbLayer4Nat, lbLayersCompared, proxyVsReverse } from './load-balancer.mjs';

export const diagrams = {
  'lb-request-flow': lbRequestFlow,
  'lb-layer4-nat': lbLayer4Nat,
  'lb-layers-compared': lbLayersCompared,
  'proxy-vs-reverse': proxyVsReverse,
};
