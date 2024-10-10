import { Stack, StackProps, CfnOutput, Tags, Environment } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IdentityProvider } from './identity-provider';
import { ApiGateway } from './api-gateway';
import { Services } from './services';
import { TenantUsageBucket } from "./tenant-usage-bucket";
import { SaaSTenantProvision } from './saas-tenant-provision';
import { SharedServicesUsageAggregatorStack } from './usage-aggregator';
import { CdkNagUtils } from '../utils/cdk-nag-utils'
import { AthenaOutputBucket } from './athena-output-bucket';

export interface SharedServicesStackProps extends StackProps {
  env: Environment;
}

export class SharedServicesStack extends Stack {
  constructor(scope: Construct, id: string, props: SharedServicesStackProps) {
    super(scope, id, props);

    // Handle CDK nag suppressions.
    CdkNagUtils.suppressCDKNag(this);

    Tags.of(this).add('saas-app-plane', 'shared-infra');

    const tenantUsageBucket = new TenantUsageBucket(this, 'TenantUsageBucket', {accountId: this.account})

    new SaaSTenantProvision(this, 'SaaSTenantProvision')

    const identityProvider = new IdentityProvider(this, 'IdentityProvider');

    const identityDetails = identityProvider.identityDetails

    const apiGateway = new ApiGateway(this, 'ApiGateway', {
      idpDetails: identityDetails,
    });

    const services = new Services(this, 'Services', {
      idpDetails: identityDetails,
      restApi: apiGateway.restApi,
      tenantScopedAccessRole: apiGateway.tenantScopedAccessRole,
    });

    new SharedServicesUsageAggregatorStack(this, 'ProductServiceUsageAggregatorStack', {
      serverlessSaaSAPIAccessLogArn: apiGateway.restAPIAccessLogGroup.logGroupArn,
      serverlessSaaSAPIAccessLogName: apiGateway.restAPIAccessLogGroup.logGroupName,
      tenantUsageBucketName: tenantUsageBucket.tenantUsageBucketName,
      tenantUsageBucketArn: tenantUsageBucket.tenantUsageBucketArn
    });

    // Athena output bucket for specifying the output location of the Athena Workgroup
    new AthenaOutputBucket(this, 'AthenaOutputBucket', {accountId: this.account})

    new CfnOutput(this, 'TenantIdpName', {
      value: identityProvider.identityDetails.name,
      exportName: 'TenantIdpName',
    });

    new CfnOutput(this, 'TenantUserpoolId', {
      value: identityProvider.identityDetails.details['userPoolId'],
      exportName: 'TenantUserpoolId',
    });

    new CfnOutput(this, 'TenantUserPoolClientId', {
      value: identityProvider.identityDetails.details['appClientId'],
      exportName: 'TenantUserPoolClientId',
    });

    new CfnOutput(this, 'AppPlaneApiGatewayUrl', {
      value: apiGateway.restApi.url,
      exportName: 'AppPlaneApiGatewayUrl',
    });

    new CfnOutput(this, 'AppPlaneApiGatewayId', {
      value: apiGateway.restApi.restApiId,
      exportName: 'AppPlaneApiGatewayId',
    });

    new CfnOutput(this, 'AppPlaneApiGatewayRootResourceId', {
      value: apiGateway.restApi.restApiRootResourceId,
      exportName: 'AppPlaneApiGatewayRootResourceId',
    });

    new CfnOutput(this, 'TenantScopedAccessRoleArn', {
      value: apiGateway.tenantScopedAccessRole.roleArn,
      exportName: 'TenantScopedAccessRoleArn',
    });

    new CfnOutput(this, 'AppPlaneAPIAccessLogGroupName', {
      value: apiGateway.restAPIAccessLogGroup.logGroupName,
      exportName: 'AppPlaneAPIAccessLogGroupName',
    });

    new CfnOutput(this, 'AuthorizerFunctionArn', {
      value: apiGateway.authorizerFunctionArn,
      exportName: 'AuthorizerFunctionArn',
    });
  }
}
