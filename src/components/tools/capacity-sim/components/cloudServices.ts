/**
 * The managed service each diagram component corresponds to on the major
 * cloud providers, with their official architecture icons:
 * - AWS: AWS Architecture Icons (via the aws-icons package)
 * - Google Cloud: Google Cloud icons (cloud.google.com/icons)
 * - Azure: Azure Public Service Icons V24 (learn.microsoft.com/azure/architecture/icons)
 */
import type { DiagramNodeId } from './layout';

import awsCdn from '../icons/aws/AmazonCloudFront.svg?url';
import awsLb from '../icons/aws/ElasticLoadBalancing.svg?url';
import awsApp from '../icons/aws/AmazonEC2.svg?url';
import awsCache from '../icons/aws/AmazonElastiCache.svg?url';
import awsDb from '../icons/aws/AmazonRDS.svg?url';
import gcpCdn from '../icons/gcp/CloudCDN.svg?url';
import gcpLb from '../icons/gcp/CloudLoadBalancing.svg?url';
import gcpApp from '../icons/gcp/ComputeEngine.svg?url';
import gcpCache from '../icons/gcp/Memorystore.svg?url';
import gcpDb from '../icons/gcp/CloudSQL.svg?url';
import azureCdn from '../icons/azure/FrontDoor.svg?url';
import azureLb from '../icons/azure/ApplicationGateway.svg?url';
import azureApp from '../icons/azure/VirtualMachines.svg?url';
import azureCache from '../icons/azure/ManagedRedis.svg?url';
import azureDb from '../icons/azure/DatabasePostgreSQL.svg?url';

export type Provider = 'aws' | 'gcp' | 'azure';
export const PROVIDERS: Provider[] = ['aws', 'gcp', 'azure'];

/** Components that have a cloud equivalent; the primary and its replicas share one. */
export type ServiceSlot = 'cdn' | 'lb' | 'app' | 'cache' | 'db';
export const SERVICE_SLOTS: ServiceSlot[] = ['cdn', 'lb', 'app', 'cache', 'db'];

export interface CloudService {
  icon: string;
  name: string;
}

export const SERVICES: Record<Provider, Record<ServiceSlot, CloudService>> = {
  aws: {
    cdn: { icon: awsCdn, name: 'Amazon CloudFront' },
    lb: { icon: awsLb, name: 'Elastic Load Balancing' },
    app: { icon: awsApp, name: 'Amazon EC2' },
    cache: { icon: awsCache, name: 'Amazon ElastiCache' },
    db: { icon: awsDb, name: 'Amazon RDS' },
  },
  gcp: {
    cdn: { icon: gcpCdn, name: 'Cloud CDN' },
    lb: { icon: gcpLb, name: 'Cloud Load Balancing' },
    app: { icon: gcpApp, name: 'Compute Engine' },
    cache: { icon: gcpCache, name: 'Memorystore' },
    db: { icon: gcpDb, name: 'Cloud SQL' },
  },
  azure: {
    cdn: { icon: azureCdn, name: 'Azure Front Door' },
    lb: { icon: azureLb, name: 'Azure Application Gateway' },
    app: { icon: azureApp, name: 'Azure Virtual Machines' },
    cache: { icon: azureCache, name: 'Azure Managed Redis' },
    db: { icon: azureDb, name: 'Azure Database for PostgreSQL' },
  },
};

/**
 * AWS icons are full coloured squares; Google Cloud and Azure icons are bare
 * glyphs that need a light tile behind them to stand out on the dark boxes.
 */
export const NEEDS_TILE: Record<Provider, boolean> = { aws: false, gcp: true, azure: true };

export function slotFor(id: DiagramNodeId): ServiceSlot | null {
  if (id === 'clients') return null;
  if (id === 'dbPrimary' || id === 'dbReplica') return 'db';
  return id;
}
