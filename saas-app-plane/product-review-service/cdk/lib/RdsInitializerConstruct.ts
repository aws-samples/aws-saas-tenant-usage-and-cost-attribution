
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { AwsCustomResource, AwsCustomResourcePolicy, AwsSdkCall, PhysicalResourceId } from 'aws-cdk-lib/custom-resources'
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import path = require('path');
import * as iam from 'aws-cdk-lib/aws-iam';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets'


export interface RDSInitializerProps {
  vpc: ec2.IVpc,
  dbCredSecretName: string
  secretArn: string
  productReviewDBName: string
}

export class RDSInitializer extends Construct {
  public readonly response: string
  public readonly customResource: AwsCustomResource
  public readonly function: lambda.Function
  public readonly fnSg: ec2.SecurityGroup
  public readonly rdsInitializerLambdaName: string;

  constructor(scope: Construct, id: string, props: RDSInitializerProps) {
    super(scope, id)

    const fnSg = new ec2.SecurityGroup(this, 'InitializerFnSg', {
      securityGroupName: `${id}InitializerFnSg`,
      vpc: props.vpc,
      allowAllOutbound: true
    })

    const logGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/RDSInitializer${id}`,
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY
    });

    //a new lambda role that grants getscretvalue
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: ['*'],
    }));



    const lambdaFunction = new lambda_python.PythonFunction(this, `RDSInitializer${id}`, {
      entry: path.join(__dirname, '../../src/lambdas-rds'),
      index: 'rds.py',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler",
      logGroup: logGroup,
      vpc: props.vpc,
      vpcSubnets: props.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }),
      securityGroups: [fnSg],
      environment: {
        DB_CRED_SECRET_NAME: props.dbCredSecretName,
        DB_NAME: props.productReviewDBName
      },
      role: lambdaRole,
      timeout: Duration.seconds(60)
    });

    this.function = lambdaFunction
    this.fnSg = fnSg
    this.rdsInitializerLambdaName = lambdaFunction.functionName

    const lambdaFunctionTenant = new lambda_python.PythonFunction(this, `TenantRDSInitializer${id}`, {
      entry: path.join(__dirname, '../../src/lambdas-rds'),
      index: 'rds-tenant.py',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler",
      logGroup: logGroup,
      vpc: props.vpc,
      vpcSubnets: props.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }),
      securityGroups: [fnSg],
      environment: {
        DB_CRED_SECRET_NAME: props.dbCredSecretName,
        DB_NAME: props.productReviewDBName
      },
      role: lambdaRole,
      timeout: Duration.seconds(60)
    });

    new CfnOutput(this, `RDSInitializerLambdaName`, { value: lambdaFunction.functionName, exportName: `RDSInitializerLambdaName` })
    new CfnOutput(this, `TenantRDSInitializerLambdaName`, { value: lambdaFunctionTenant.functionName, exportName: `TenantRDSInitializerLambdaName` })
    new CfnOutput(this, `ProductReviewDBName`, { value: props.productReviewDBName, exportName: `ProductReviewDBName` })
  }

}
