import { Aspects, App } from 'aws-cdk-lib';
import { ApplicationPlaneStack } from '../lib/application-plane-stack';
import { ECSServiceStack } from '../lib/ecs-service-stack';
import { TenantProvisioningStack } from '../lib/tenant-provisioning-stack';
import { UsageAggregator } from '../lib/UsageAggregatorConstruct';
import { AwsSolutionsChecks } from 'cdk-nag'

const app = new App();
// Add the cdk-nag AwsSolutions Pack with extra verbose logging enabled.
Aspects.of(app).add(new AwsSolutionsChecks({verbose: true}));

// Read environment variables
const awsAccountId = process.env.AWS_ACCOUNT_ID;
const awsRegion = process.env.AWS_REGION;

const env = { account: awsAccountId, region: awsRegion };

// Create app plane
new ApplicationPlaneStack(app, 'ProductReviewAppStack', {env});

const imageVersion = app.node.tryGetContext('imageVersion');

// Add ECS service, build the image before this
new ECSServiceStack(app, 'ProductReviewECSServiceStack', { 
    imageVersion: imageVersion,
    listenerRulePriorityBase: 100 
});

const tenantId = app.node.tryGetContext('tenantId');

new TenantProvisioningStack(app, `ProductReviewTenantProvisioningStack-${tenantId}`, {tenantId})

