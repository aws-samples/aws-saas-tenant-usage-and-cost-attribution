import { Stack, CfnOutput, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { LambdaFunction } from './lambda-function';
import * as path from "path";
import * as iam from 'aws-cdk-lib/aws-iam';

export interface UsageAggregatorProps {
  serverlessSaaSAPIAccessLogArn: string;
  serverlessSaaSAPIAccessLogName: string;
  tenantUsageBucketName: string;
  tenantUsageBucketArn: string;
}

export class SharedServicesUsageAggregatorStack extends Construct {
  constructor(scope: Construct, id: string, props: UsageAggregatorProps) {
    super(scope, id);

    const serverlessSaaSAPIAccessLogArn = props.serverlessSaaSAPIAccessLogArn
    const serverlessSaaSAPIAccessLogName = props.serverlessSaaSAPIAccessLogName
    const tenantUsageBucketArn = props.tenantUsageBucketArn;
    const tenantUsageBucketName = props.tenantUsageBucketName;

    const coarseGrainedAggregatorLambda = new LambdaFunction(this, 'CoarseGrainedAggregatorLambda', {
      entry: path.join(__dirname, '../../src'),
      handler: 'lambda_handler',
      index: 'coarse_grained_aggregator.py',
      powertoolsServiceName: 'COARSE_GRAINED_AGGREGATOR',
      powertoolsNamespace: 'TenantUsageAggregator',
      logLevel: 'DEBUG',
    });

    coarseGrainedAggregatorLambda.lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:StartQuery', 'logs:GetQueryResults'],
        resources: [serverlessSaaSAPIAccessLogArn],
      })
    );

    coarseGrainedAggregatorLambda.lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject'],
        resources: [`${tenantUsageBucketArn}/*`],
      })
    );
    coarseGrainedAggregatorLambda.lambdaFunction.addEnvironment('SERVERLESS_SAAS_API_GATEWAY_ACCESS_LOGS', serverlessSaaSAPIAccessLogName);
    coarseGrainedAggregatorLambda.lambdaFunction.addEnvironment('TENANT_USAGE_BUCKET', tenantUsageBucketName);

    new CfnOutput(this, 'CoarseGrainedUsageAggregatorLambda', {
      value: coarseGrainedAggregatorLambda.lambdaFunction.functionName,
      exportName: 'CoarseGrainedUsageAggregatorLambda',
    });
  }
}
