import { Stack, StackProps, CfnOutput, Fn, aws_iam, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Services } from './services';
import { ProductServiceUsageAggregatorStack } from './usage-aggregator';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { RestApi, Deployment } from 'aws-cdk-lib/aws-apigateway';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { CdkNagUtils } from '../utils/cdk-nag-utils'

export class ServerlessSaaSAppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Handle CDK nag suppressions.
    CdkNagUtils.suppressCDKNag(this);

    Tags.of(this).add('saas-app-plane', 'product-and-order');

    const appPlaneRestAPIId = Fn.importValue('AppPlaneApiGatewayId')
    const appPlaneRestAPIRootResourceId = Fn.importValue('AppPlaneApiGatewayRootResourceId')
    const appPlaneAPIAccessLogGroupName = Fn.importValue('AppPlaneAPIAccessLogGroupName')
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArn')

    const apiGateway = RestApi.fromRestApiAttributes(this, 'ApiGateway', {
      restApiId: appPlaneRestAPIId,
      rootResourceId: appPlaneRestAPIRootResourceId,
    })

    const apiGatewayLogGroup = LogGroup.fromLogGroupName(this, 'ApiGatewayLogGroup', appPlaneAPIAccessLogGroupName)

    const tenantScopedAccessRoleArn = Fn.importValue('TenantScopedAccessRoleArn')
    const tenantScopedAccessRole = aws_iam.Role.fromRoleArn(this, 'TenantScopedAccessRole', tenantScopedAccessRoleArn)

    const services = new Services(this, 'Services', {
      restApi: apiGateway,
      tenantScopedAccessRole: tenantScopedAccessRole,
      authorizerFunctionArn: authorizerFunctionArn,
    });

    new Deployment(this, 'Deployment', {
      api: RestApi.fromRestApiId(this, 'RestApi', appPlaneRestAPIId),
      stageName: 'prod'
    });

    new ProductServiceUsageAggregatorStack(this, 'ProductServiceUsageAggregatorStack', {
      serverlessSaaSAPIAccessLogArn: apiGatewayLogGroup.logGroupArn,
      serverlessSaaSAPIAccessLogName: apiGatewayLogGroup.logGroupName,
      serverlessServicesLogGroupArn: services.serverlessServicesLogGroupArn,
    });

    new CfnOutput(this, 'ProductTableName', {
      value: services.productMicroservice.table.tableName,
    });

    new CfnOutput(this, 'OrderTableName', {
      value: services.orderMicroservice.table.tableName,
    });
  }

  ssmLookup(parameterName: string) {
    return StringParameter.valueForStringParameter(this, parameterName);
  }
}
