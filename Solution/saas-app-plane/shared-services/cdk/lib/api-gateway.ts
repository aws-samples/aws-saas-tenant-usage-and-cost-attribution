import { Duration, aws_iam, RemovalPolicy } from 'aws-cdk-lib';
import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import {
  AuthorizationType,
  IdentitySource,
  RestApi,
  TokenAuthorizer,
  LogGroupLogDestination,
  AccessLogFormat,
  MethodLoggingLevel,
} from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import { IdentityDetails } from '../interfaces/identity-details';
import { LambdaFunction } from './lambda-function';
import {LogGroup, RetentionDays} from 'aws-cdk-lib/aws-logs';

interface ApiGatewayProps {
  idpDetails: IdentityDetails;  
}

export class ApiGateway extends Construct {
  public readonly restApi: RestApi;
  public readonly tenantScopedAccessRole: aws_iam.Role;
  public readonly authorizerFunctionArn: string;
  public readonly restAPIAccessLogGroup: LogGroup;

  constructor(scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id);

    this.restAPIAccessLogGroup = new LogGroup(this, 'APIGatewayAccessLogs', {
      removalPolicy: RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_WEEK,
    });

    const authorizerFunction = new LambdaFunction(this, 'AuthorizerFunction', {
      entry: path.join(__dirname, '../../src'),
      handler: 'lambda_handler',
      index: 'tenant_authorizer.py',
      powertoolsServiceName: 'AUTHORIZER',      
      powertoolsNamespace: 'AppPlane',
      logLevel: 'DEBUG',      
    });
    authorizerFunction.lambdaFunction.addEnvironment('IDP_DETAILS', JSON.stringify(props.idpDetails))

    if (!authorizerFunction.lambdaFunction.role?.roleArn) {
      throw new Error('AuthorizerFunction roleArn is undefined');
    }
    this.tenantScopedAccessRole = new aws_iam.Role(this, 'AuthorizerAccessRole', {
      assumedBy: new aws_iam.ArnPrincipal(authorizerFunction.lambdaFunction.role?.roleArn),
    });
    authorizerFunction.lambdaFunction.addEnvironment(
      'AUTHORIZER_ACCESS_ROLE',
      this.tenantScopedAccessRole.roleArn
    );

    this.restApi = new RestApi(this, `appPlaneAPI`, {
      defaultMethodOptions: {        
        authorizationType: AuthorizationType.CUSTOM,
        authorizer: new TokenAuthorizer(this, 'TenantAPIAuthorizer', {
          handler: authorizerFunction.lambdaFunction,
          identitySource: IdentitySource.header('Authorization'),
          resultsCacheTtl: Duration.seconds(30),
        }),
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },      
      deployOptions: {
        accessLogDestination: new LogGroupLogDestination(this.restAPIAccessLogGroup),
        accessLogFormat: AccessLogFormat.custom(
          '{"tenantId":"$context.authorizer.tenantId","feature":"$context.authorizer.feature", "responseLatency":"$context.responseLatency", "requestId":"$context.requestId", \
          "ip":"$context.identity.sourceIp", "requestTime":"$context.requestTime", "httpMethod":"$context.httpMethod", \
          "routeKey":"$context.routeKey", "status":"$context.status", "protocol":"$context.protocol", \
          "responseLength":"$context.responseLength", "resourcePath":"$context.resourcePath"}'),        

        loggingLevel: MethodLoggingLevel.INFO,
        metricsEnabled: true,
      },
      binaryMediaTypes: ['image/png', 'image/jpg', 'video/mp4', 'text/plain']
    }); 
    
    this.authorizerFunctionArn = authorizerFunction.lambdaFunction.functionArn;
    
  }
}
