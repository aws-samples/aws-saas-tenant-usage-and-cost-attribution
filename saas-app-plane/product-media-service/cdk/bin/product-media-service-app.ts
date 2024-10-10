import { Aspects, App } from 'aws-cdk-lib';
import { ApplicationPlaneStack } from '../lib/application-plane-stack';
import { TenantProvisionStack } from '../lib/tenant-provision-stack';
import { AwsSolutionsChecks } from 'cdk-nag'

const app = new App();
// Add the cdk-nag AwsSolutions Pack with extra verbose logging enabled.
Aspects.of(app).add(new AwsSolutionsChecks({verbose: true}));

// Environment variables.
const accountId = process.env.ACCOUNT_ID;
const region = process.env.REGION;
const tenantId = process.env.TENANT_ID;
const listenerRulePriorityBase = Number(process.env.PRIORITY_BASE);

// Deploy base application stack.
const env = {account: accountId, region: region}

// Deploy tenant stack.
if (tenantId && !isNaN(listenerRulePriorityBase)) {
  const stackName = `ProductMediaTenantStack-${tenantId}`;
  new TenantProvisionStack(app, stackName, {tenantId, listenerRulePriorityBase, env});
} else {
  new ApplicationPlaneStack(app, 'ProductMediaAppStack', {env});
}
