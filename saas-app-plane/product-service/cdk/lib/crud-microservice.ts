import {  Duration, aws_dynamodb, aws_apigateway } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { LambdaFunction } from './lambda-function';
import { CfnPermission, Function } from 'aws-cdk-lib/aws-lambda';

import {
  AuthorizationType,
  RequestAuthorizer,
  Resource,
  LambdaIntegration,
  MethodOptions
} from 'aws-cdk-lib/aws-apigateway';
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";

interface MicroserviceProps {
  index: string;
  serviceName: string;
  entry: string;
  sortKey: string;
  apiGatewayResource: Resource;
  handlers: {
    create: string;
    get: string;
    getAll: string;
    update: string;
    delete: string;
  };
  logLevel: string;
  layers?: lambda.LayerVersion[];
  logGroup: logs.LogGroup,
  authorizerFunctionArn: string
}

export class Microservice extends Construct {
  public readonly table: aws_dynamodb.Table;
  constructor(scope: Construct, id: string, props: MicroserviceProps) {
    super(scope, id);

    const powertoolsNamespace = 'SERVERLESS_SAAS'
    const idResource = props.apiGatewayResource.addResource('{id}');

    this.table = new aws_dynamodb.Table(this, 'Table', {
      billingMode: aws_dynamodb.BillingMode.PROVISIONED,
      readCapacity: 5,
      writeCapacity: 5,
      partitionKey: {
        name: 'shardId',
        type: aws_dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: props.sortKey,
        type: aws_dynamodb.AttributeType.STRING,
      },
    });

    const getLambdaFunctionConstruct = new LambdaFunction(this, 'GetFunction', {
      entry: props.entry,
      handler: props.handlers.get,
      index: props.index,
      powertoolsServiceName: props.serviceName,
      powertoolsNamespace: powertoolsNamespace,
      logLevel: props.logLevel,
      layers: props.layers,
      logGroup: props.logGroup
    });

    getLambdaFunctionConstruct.lambdaFunction.addEnvironment('TABLE_NAME', this.table.tableName);
    const authorizer_function_arn = props.authorizerFunctionArn

    const authorizerFunction = Function.fromFunctionArn(
      this,
      "AuthorizerFunction",
      authorizer_function_arn
    );

    const requestAuthorizer =  new RequestAuthorizer(this, 'TenantAPIAuthorizer', {
      handler: authorizerFunction,
      identitySources:[
        aws_apigateway.IdentitySource.header('x-service-identifier'),
        aws_apigateway.IdentitySource.header('Authorization'),
      ],
      resultsCacheTtl: Duration.seconds(30),
    });

    new CfnPermission(this, 'AuthorizerPermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunction.functionName,
      principal: 'apigateway.amazonaws.com',
      sourceArn: requestAuthorizer.authorizerArn
    })

    const methodOptions : MethodOptions = {
      authorizationType: AuthorizationType.CUSTOM,
      authorizer: requestAuthorizer
    }
    idResource.addMethod(
      'GET',
      new LambdaIntegration(getLambdaFunctionConstruct.lambdaFunction, {
        proxy: true,
      }),
      methodOptions
    );
    this.table.grantReadData(getLambdaFunctionConstruct.lambdaFunction);

    const getAllLambdaFunctionConstruct = new LambdaFunction(this, 'GetAllFunction', {
      entry: props.entry,
      handler: props.handlers.getAll,
      index: props.index,
      powertoolsServiceName: props.serviceName,
      powertoolsNamespace: powertoolsNamespace,
      logLevel: props.logLevel,
      layers: props.layers,
      logGroup: props.logGroup
    });


    props.apiGatewayResource.addMethod(
      'GET',
      new LambdaIntegration(getAllLambdaFunctionConstruct.lambdaFunction, {
        proxy: true,
      }),
      methodOptions
    );

    getAllLambdaFunctionConstruct.lambdaFunction.addEnvironment('TABLE_NAME', this.table.tableName);
    this.table.grantReadData(getAllLambdaFunctionConstruct.lambdaFunction);

    const createLambdaFunctionConstruct = new LambdaFunction(this, 'CreateFunction', {
      entry: props.entry,
      handler: props.handlers.create,
      index: props.index,
      powertoolsServiceName: props.serviceName,
      powertoolsNamespace: powertoolsNamespace,
      logLevel: props.logLevel,
      layers: props.layers,
      logGroup: props.logGroup
    });
    props.apiGatewayResource.addMethod(
      'POST',
      new LambdaIntegration(createLambdaFunctionConstruct.lambdaFunction, {
        proxy: true,
      }),
      methodOptions
    );
    this.table.grantWriteData(createLambdaFunctionConstruct.lambdaFunction);
    createLambdaFunctionConstruct.lambdaFunction.addEnvironment('TABLE_NAME', this.table.tableName);

    const updateLambdaFunctionConstruct = new LambdaFunction(this, 'UpdateFunction', {
      entry: props.entry,
      handler: props.handlers.update,
      index: props.index,
      powertoolsServiceName: props.serviceName,
      powertoolsNamespace: powertoolsNamespace,
      logLevel: props.logLevel,
      layers: props.layers,
      logGroup: props.logGroup
    });
    idResource.addMethod(
      'PUT',
      new LambdaIntegration(createLambdaFunctionConstruct.lambdaFunction, {
        proxy: true,
      }),
      methodOptions
    );
    this.table.grantWriteData(updateLambdaFunctionConstruct.lambdaFunction);
    updateLambdaFunctionConstruct.lambdaFunction.addEnvironment('TABLE_NAME', this.table.tableName);

    const deleteLambdaFunctionConstruct = new LambdaFunction(this, 'DeleteFunction', {
      entry: props.entry,
      handler: props.handlers.delete,
      index: props.index,
      powertoolsServiceName: props.serviceName,
      powertoolsNamespace: powertoolsNamespace,
      logLevel: props.logLevel,
      layers: props.layers,
      logGroup: props.logGroup
    });
    idResource.addMethod(
      'DELETE',
      new LambdaIntegration(createLambdaFunctionConstruct.lambdaFunction, {
        proxy: true,
      }),
      methodOptions
    );
    this.table.grantWriteData(deleteLambdaFunctionConstruct.lambdaFunction);
    deleteLambdaFunctionConstruct.lambdaFunction.addEnvironment('TABLE_NAME', this.table.tableName);
  }
}
