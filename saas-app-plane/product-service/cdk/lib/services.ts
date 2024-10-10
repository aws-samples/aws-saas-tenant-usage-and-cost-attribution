import * as path from 'path';
import {
  IRole,
} from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { IRestApi } from 'aws-cdk-lib/aws-apigateway';
import { Microservice } from './crud-microservice';
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from "aws-cdk-lib/aws-logs";
import { RemovalPolicy } from "aws-cdk-lib";

export interface ServicesProps {
  restApi: IRestApi;
  tenantScopedAccessRole: IRole;
  authorizerFunctionArn: string,
}

export class Services extends Construct {
  public readonly productMicroservice: Microservice;
  public readonly orderMicroservice: Microservice;
  public readonly serverlessServicesLogGroupArn: string;

  constructor(scope: Construct, id: string, props: ServicesProps) {
    super(scope, id);

    const productMicroserviceResource = props.restApi.root.addResource('product');
    const orderMicroserviceResource = props.restApi.root.addResource('order');

    const corePreflight = {
      allowOrigins: ['*'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
      allowHeaders: [
        'Content-Type',
        'Authorization',
        'X-Amz-Date',
        'X-Api-Key',
        'X-Amz-Security-Token',
      ],
    }
    
    productMicroserviceResource.addCorsPreflight(corePreflight) 
    orderMicroserviceResource.addCorsPreflight(corePreflight)

    const telemetryAPIExtension = new lambda.LayerVersion(this, 'telemetry-api-extension', {
      layerVersionName: 'python-telemetry-api',
      code: lambda.Code.fromAsset(__dirname + '../../../src/extensions/telemetry-api/extension.zip'),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_10],
      description: 'Telemetry API Extension for emitting tenant aware platform report.'
    });

    const serverlessServicesLogGroup = new logs.LogGroup(this, 'ServerlessServiceLogGroup', {
      logGroupName: 'serverless-services-log-group',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY
    });
    
    this.serverlessServicesLogGroupArn = serverlessServicesLogGroup.logGroupArn
    
    this.productMicroservice = new Microservice(this, 'ProductMicroservice', {
      index: 'product_service.py',
      serviceName: 'ProductService',
      entry: path.join(__dirname, '../../src'),
      sortKey: 'productId',
      apiGatewayResource: productMicroserviceResource,
      handlers: {
        getAll: 'get_products',
        create: 'create_product',
        get: 'get_product',
        update: 'update_product',
        delete: 'delete_product',
      },
      logLevel: 'DEBUG',
      layers: [telemetryAPIExtension],
      logGroup: serverlessServicesLogGroup,
      authorizerFunctionArn: props.authorizerFunctionArn,
    });
    this.productMicroservice.table.grantReadWriteData(props.tenantScopedAccessRole);

    this.orderMicroservice = new Microservice(this, 'OrderMicroservice', {
      index: 'order_service.py',
      handlers: {
        getAll: 'get_orders',
        create: 'create_order',
        get: 'get_order',
        update: 'update_order',
        delete: 'delete_order',
      },
      serviceName: 'OrderService',
      entry: path.join(__dirname, '../../src'),
      sortKey: 'orderId',
      apiGatewayResource: orderMicroserviceResource,
      logLevel: 'DEBUG',
      layers: [telemetryAPIExtension],
      logGroup: serverlessServicesLogGroup,
      authorizerFunctionArn: props.authorizerFunctionArn,
    });
    this.orderMicroservice.table.grantReadWriteData(props.tenantScopedAccessRole);

  }
}
