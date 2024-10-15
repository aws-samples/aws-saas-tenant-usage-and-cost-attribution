import { CfnOutput, Fn }  from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { LambdaFunction } from './lambda-function';
import * as path from "path";
import * as iam from 'aws-cdk-lib/aws-iam';

export interface UsageAggregatorProps {
  serverlessSaaSAPIAccessLogArn: string;
  serverlessSaaSAPIAccessLogName: string;
  serverlessServicesLogGroupArn: string;  
}

export class ProductServiceUsageAggregatorStack extends Construct {
  constructor(scope: Construct, id: string, props: UsageAggregatorProps) {
    super(scope, id);

    const serverlessServicesLogGroupArn = props.serverlessServicesLogGroupArn
    const tenantUsageBucketArn = Fn.importValue('TenantUsageBucketArn')
    const tenantUsageBucketName = Fn.importValue('TenantUsageBucketName')

    const fineGrainedAggregatorLambda = new LambdaFunction(this, 'FineGrainedAggregatorLambda', {
      entry: path.join(__dirname, '../../src'),
      handler: 'lambda_handler',
      index: 'fine_grained_aggregator.py',
      powertoolsServiceName: 'FINE_GRAINED_AGGREGATOR',
      powertoolsNamespace: 'FineGrainedTenantUsageAggregator',
      logLevel: 'DEBUG',
    });

    fineGrainedAggregatorLambda.lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:StartQuery','logs:GetQueryResults'],
        resources: [serverlessServicesLogGroupArn],
      })
    );

    fineGrainedAggregatorLambda.lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject'],
        resources: [`${tenantUsageBucketArn}/*`],
      })
    );
    fineGrainedAggregatorLambda.lambdaFunction.addEnvironment('TENANT_USAGE_BUCKET', tenantUsageBucketName);

    // const schedulerRole = new iam.Role(this, 'SchedulerRole', {
    //   assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    //   inlinePolicies: {
    //     TenantUsageAggregatorPolicy: new iam.PolicyDocument({
    //       statements: [
    //         new iam.PolicyStatement({
    //           effect: iam.Effect.ALLOW,
    //           actions: ['lambda:InvokeFunction'],
    //           resources: [coarseGrainedAggregatorLambda.lambdaFunction.functionArn],
    //         }),
    //       ],
    //     }),
    //   },
    // });
    // // a new event bridge scheduler that triggers a lambda function on a daily basis
    // new cdk.aws_scheduler.CfnSchedule(this, 'CoarseGrainedUsageAggregatorScheduler', {
    //   flexibleTimeWindow: { mode: 'OFF' },
    //   // example schedule expression that runs once a day at 11:55 PM and consolidates usage for that day. 
    //   scheduleExpression: 'cron(55 23 * * ? *)',
    //   target: {
    //     arn: coarseGrainedAggregatorLambda.lambdaFunction.functionArn,
    //     roleArn: schedulerRole.roleArn,
    //   },
    // });    

    //cfn output

    new CfnOutput(this, 'FineGrainedUsageAggregatorLambda', {
      value: fineGrainedAggregatorLambda.lambdaFunction.functionName,
      exportName: 'FineGrainedUsageAggregatorLambda',
    });
  } 
}
