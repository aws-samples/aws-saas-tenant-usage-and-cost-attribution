import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { Fn, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { AwsCustomResource, AwsCustomResourcePolicy, AwsSdkCall, PhysicalResourceId } from 'aws-cdk-lib/custom-resources'
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import path = require('path');
import * as iam from 'aws-cdk-lib/aws-iam';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets'

export interface UsageAggregatorProps {
    vpc: ec2.IVpc,
    dbCredSecretName: string
    productReviewDBName: string
    rdsInstanceIdentifier: string
    rdsPostgresSg: ec2.SecurityGroup
}

export class UsageAggregator extends Construct {
    public readonly response: string;
    public readonly customResource: AwsCustomResource;
    public readonly function: lambda.Function;
    public readonly fnSg: ec2.SecurityGroup;
    public readonly rdsInitializerLambdaName: string;
    public readonly aggregatorLambdaSg: ec2.SecurityGroup;

    constructor(scope: Construct, id: string, props: UsageAggregatorProps) {
        super(scope, id)

        // Import values from ApplicationPlaneStack outputs
        const tenantUsageBucketName = Fn.importValue('TenantUsageBucketName')

        const aggregatorLambdaSg = new ec2.SecurityGroup(this, 'AggregatorLambdaSg', {
            securityGroupName: `${id}AggregatorLambdaSg`,
            vpc: props.vpc,
            allowAllOutbound: true
        })
        // add the ingress rule into the rdsPostgres.dbsg with the UsageAggregatorSG for port 5432 to enable Aggregator Lambda to perform queries
        props.rdsPostgresSg.addIngressRule(aggregatorLambdaSg, ec2.Port.tcpRange(5432, 5432), 'Review Service Usage Aggregator Lambda to PostgresSQL 5432')


        const logGroupAggregatorLambda = new LogGroup(this, 'AggregatorLambdaLogGroup', {
            logGroupName: `/aws/lambda/AggregatorLambda${id}`,
            retention: RetentionDays.ONE_WEEK,
            removalPolicy: RemovalPolicy.DESTROY
        });

        //a new lambda role that grants getscretvalue
        const aggregatorLambdaRole = new iam.Role(this, 'AggregatorLambdaRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        });
        aggregatorLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
        aggregatorLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'));
        aggregatorLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonRDSReadOnlyAccess'));
        // TODO restrict S3 access only for the specific buckets
        aggregatorLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'));
        aggregatorLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'));
        aggregatorLambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'));

        aggregatorLambdaRole.addToPolicy(new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue'],
            resources: ['*'],
        }));

        const lambdaRDSIopsUsage = new lambda_python.PythonFunction(this, `RDSIopsUsageLambda${id}`, {
            entry: path.join(__dirname, '../../src/lambdas-aggregator'),
            index: 'rds-iops-usage.py',
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "lambda_handler",
            logGroup: logGroupAggregatorLambda,
            vpc: props.vpc,
            vpcSubnets: props.vpc.selectSubnets({
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            }),
            securityGroups: [aggregatorLambdaSg],
            environment: {
                SECRET_NAME: props.dbCredSecretName,
                TENANT_USAGE_BUCKET: tenantUsageBucketName,
                PRODUCT_REVIEW_DB_NAME: props.productReviewDBName
            },
            role: aggregatorLambdaRole,
            timeout: Duration.seconds(60),
            memorySize: 512
        });

        this.function = lambdaRDSIopsUsage
        this.fnSg = aggregatorLambdaSg
        this.rdsInitializerLambdaName = lambdaRDSIopsUsage.functionName

        const lambdaRDSStorageUsage = new lambda_python.PythonFunction(this, `RDSStorageUsageLambda${id}`, {
            entry: path.join(__dirname, '../../src/lambdas-aggregator'),
            index: 'rds-storage-usage.py',
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "lambda_handler",
            logGroup: logGroupAggregatorLambda,
            vpc: props.vpc,
            vpcSubnets: props.vpc.selectSubnets({
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            }),
            securityGroups: [aggregatorLambdaSg],
            environment: {
                SECRET_NAME: props.dbCredSecretName,
                TENANT_USAGE_BUCKET: tenantUsageBucketName,
                PRODUCT_REVIEW_DB_NAME: props.productReviewDBName
            },
            role: aggregatorLambdaRole,
            timeout: Duration.seconds(60),
            memorySize: 512

        });

        const lambdaRDSPerformanceInsights = new lambda_python.PythonFunction(this, `RDSPerformanceInsightsLambda${id}`, {
            entry: path.join(__dirname, '../../src/lambdas-aggregator'),
            index: 'rds-performance-insights.py',
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "lambda_handler",
            logGroup: logGroupAggregatorLambda,
            vpc: props.vpc,
            vpcSubnets: props.vpc.selectSubnets({
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            }),
            securityGroups: [aggregatorLambdaSg],
            environment: {
                SECRET_NAME: props.dbCredSecretName,
                TENANT_USAGE_BUCKET: tenantUsageBucketName,
                PRODUCT_REVIEW_DB_NAME: props.productReviewDBName,
                DB_IDENTIFIER: props.rdsInstanceIdentifier
            },
            role: aggregatorLambdaRole,
            timeout: Duration.seconds(60),
            memorySize: 512
        });

        const lambdaECSUsageAggregator = new lambda_python.PythonFunction(this, `ECSUsageAggregatorLambda${id}`, {
            entry: path.join(__dirname, '../../src/lambdas-aggregator'),
            index: 'ecs-usage-aggregator.py',
            runtime: lambda.Runtime.PYTHON_3_12,
            handler: "lambda_handler",
            logGroup: logGroupAggregatorLambda,
            vpc: props.vpc,
            vpcSubnets: props.vpc.selectSubnets({
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            }),
            securityGroups: [aggregatorLambdaSg],
            environment: {
                SECRET_NAME: props.dbCredSecretName,
                TENANT_USAGE_BUCKET: tenantUsageBucketName,
                PRODUCT_REVIEW_DB_NAME: props.productReviewDBName,
                ECS_CLOUDWATCH_LOG_GROUP: 'ProductReviewLogGroup'
            },
            role: aggregatorLambdaRole,
            timeout: Duration.seconds(60),
            memorySize: 512
        });

        new CfnOutput(this, `RDSIopsUsageLambda`, { value: lambdaRDSIopsUsage.functionName, exportName: `RDSIopsUsageLambda` })
        new CfnOutput(this, `RDSStorageUsageLambda`, { value: lambdaRDSStorageUsage.functionName, exportName: `RDSStorageUsageLambda` })
        new CfnOutput(this, `RDSPerformanceInsightsLambda`, { value: lambdaRDSPerformanceInsights.functionName, exportName: `RDSPerformanceInsightsLambda` })
        new CfnOutput(this, `ECSUsageAggregatorLambda`, { value: lambdaECSUsageAggregator.functionName, exportName: `ECSUsageAggregatorLambda` })

    }
}
