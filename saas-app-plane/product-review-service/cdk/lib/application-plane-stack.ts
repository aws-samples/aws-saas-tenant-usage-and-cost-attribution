import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  AuthorizationType,
  ConnectionType,
  Deployment,
  HttpIntegration,
  IdentitySource,
  MethodOptions,
  RequestAuthorizer,
  RestApi,
  VpcLink
} from 'aws-cdk-lib/aws-apigateway';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as lambda from "aws-cdk-lib/aws-lambda";
import { AuroraPostgres } from './RdsPostgresConstruct';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  AwsSdkCall,
  PhysicalResourceId
} from 'aws-cdk-lib/custom-resources'
import { createHash } from 'crypto'
import { UsageAggregator } from './UsageAggregatorConstruct';
import { CdkNagUtils } from '../utils/cdk-nag-utils'

export interface ApplicationPlaneStackProps extends cdk.StackProps {
}

export class ApplicationPlaneStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApplicationPlaneStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add('saas-service', 'product-review');
    // Handle CDK nag suppressions.
    CdkNagUtils.suppressCDKNag(this);

    const appPlaneRestAPIId = cdk.Fn.importValue('AppPlaneApiGatewayId');
    const appPlaneRestAPIRootResourceId = cdk.Fn.importValue('AppPlaneApiGatewayRootResourceId');
    const authorizerFunctionArn = cdk.Fn.importValue('AuthorizerFunctionArn');

    const stageName = 'prod';

    const vpcName = 'ProductReview_VPC';
    const vpc = new ec2.Vpc(this, vpcName, {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private_with_egress',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: 'private_isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }
      ]
    });

    // Create an ECS cluster
    const clusterName = 'ProductReview_Cluster';
    const cluster = new ecs.Cluster(this, clusterName, {
      vpc: vpc,
      containerInsights: true
    });

    // Create an ECR repository
    const repository = new ecr.Repository(this, 'ProductReviewServiceRepo', {
      repositoryName: 'product-review-service',
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true
    });

    // Define the repository policy
    const repositoryPolicyStatement = new iam.PolicyStatement({
      actions: ['ecr:*'],
      effect: iam.Effect.ALLOW,
      principals: [new iam.ArnPrincipal(this.account)]
    });

    // Add the policy to the repository
    repository.addToResourcePolicy(repositoryPolicyStatement);

    // Create an S3 bucket for storing ALB access logs
    const logBucket = new s3.Bucket(this, 'AlbAccessLogBucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
    });

    // Grant necessary permissions to the load balancer to write logs to the bucket
    logBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [`${logBucket.bucketArn}/AWSLogs/${this.account}/*`],
      principals: [new iam.ServicePrincipal('elasticloadbalancing.amazonaws.com')],
    }));

    // Create a security group for the ALB
    const
      albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
        vpc,
        description: 'Allow HTTP traffic to ALB',
        allowAllOutbound: true,
      });

    // Allow inbound traffic to the ALB on port 80 (or 443 for HTTPS)
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP traffic from anywhere');

    // Create an ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ProductReviewService_ALB', {
      vpc: vpc,
      internetFacing: false,
      dropInvalidHeaderFields: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      securityGroup: albSecurityGroup,
    });
    alb.logAccessLogs(logBucket);

    // Need a default action or target group.
    // Will modify listener rules to forward traffic to actual target groups on tenant provisioning.
    const listener = alb.addListener('PrivateListener', {
      port: 80,
      open: true,
      defaultAction: elbv2.ListenerAction.fixedResponse(200, {
        contentType: 'text/plain',
        messageBody: 'Default listener.'
      })
    });

    const nlb = new elbv2.NetworkLoadBalancer(this, 'ProductReviewServiceNLB', {
      vpc: vpc,
      internetFacing: false,
      crossZoneEnabled: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });
    nlb.logAccessLogs(logBucket);

    const nlbListener = nlb.addListener('nlb-listener', {
      port: 80
    });

    const nlbTargetGroup = nlbListener.addTargets('nlb-targets', {
      targets: [new targets.AlbArnTarget((alb.loadBalancerArn), 80)],
      port: 80,
      healthCheck: {
        protocol: elbv2.Protocol.HTTP,
        port: '80'
      }
    });
    nlbTargetGroup.node.addDependency(listener);

    const fargateSecurityGroup = new ec2.SecurityGroup(this, 'FargateSecurityGroup', {
      vpc,
      description: 'Allow traffic from ALB to Fargate tasks',
      allowAllOutbound: true,
    });

    // -------- Create the aurora postgres cluster
    const rdsPostgres = new AuroraPostgres(this, `ProductReviewDBServer`, {
      vpc: vpc,
      dbName: 'ProductReview',
      auroraClusterUsername: "saasadmin",
      ingressSources: [fargateSecurityGroup],
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.R6G,
        ec2.InstanceSize.LARGE
      )
    });
    const vpcLink = new VpcLink(this, 'ecs-vpc-link', {
      targets: [nlb]
    });

    // ---------- api gateway

    // Get and configure shared API Gateway.
    const apiGateway = RestApi.fromRestApiAttributes(this, 'ApiGateway', {
      restApiId: appPlaneRestAPIId,
      rootResourceId: appPlaneRestAPIRootResourceId,
    });

    // Request authorizer and method options.
    const authorizerFunction = lambda.Function.fromFunctionAttributes(this, 'SharedAuthorizer', {
      functionArn: authorizerFunctionArn,
      sameEnvironment: true
    });

    const requestAuthorizer = new RequestAuthorizer(this, 'TenantAPIAuthorizer', {
      handler: authorizerFunction,
      identitySources: [
        IdentitySource.header('x-service-identifier'),
        IdentitySource.header('Authorization'),
      ],
      resultsCacheTtl: cdk.Duration.seconds(30),
    });

    new lambda.CfnPermission(this, 'AuthorizerPermission', {
      action: 'lambda:InvokeFunction',
      functionName: authorizerFunction.functionName,
      principal: 'apigateway.amazonaws.com',
      sourceArn: requestAuthorizer.authorizerArn
    })

    const methodOptions: MethodOptions = {
      authorizationType: AuthorizationType.CUSTOM,
      authorizer: requestAuthorizer,
    }

    // Add resources.
    // Create the /productreview resource
    const productReviewResource = apiGateway.root.addResource('productreview');

    // Create the {review_id} resource under /productreview
    const productReviewIdResource = productReviewResource.addResource('{review_id}');

    const integrationPOSTProductReview = new HttpIntegration(`http://${nlb.loadBalancerDnsName}/productreview`, {
      httpMethod: 'ANY',
      proxy: true,
      options: {
        connectionType: ConnectionType.VPC_LINK,
        vpcLink: vpcLink,
        requestParameters: {
          'integration.request.header.tenantId': 'context.authorizer.tenantId'
        }
      },
    });

    const integrationGETProductReview = new HttpIntegration(`http://${nlb.loadBalancerDnsName}/productreview/{review_id}`, {
      httpMethod: 'ANY',
      proxy: true,
      options: {
        connectionType: ConnectionType.VPC_LINK,
        vpcLink: vpcLink,
        requestParameters: {
          'integration.request.header.tenantId': 'context.authorizer.tenantId'
        }
      },
    });

    productReviewResource.addMethod("POST", integrationPOSTProductReview, methodOptions);
    productReviewResource.addMethod("GET", integrationPOSTProductReview, methodOptions);
    productReviewIdResource.addMethod("GET", integrationGETProductReview, methodOptions);

    // Deploy the new resources and methods to the prod stage.
    new Deployment(this, 'ProductReviewServiceDeployment', {api: apiGateway, stageName});

    const rdsSecretName = 'ProductAuroraClusterCredentials'
    const usageAggregator = new UsageAggregator(this, 'UsageAggregator', {
      vpc: vpc,
      dbCredSecretName: rdsSecretName,
      productReviewDBName: rdsPostgres.productReviewDBName,
      rdsInstanceIdentifier: rdsPostgres.instanceIdentifier,
      rdsPostgresSg: rdsPostgres.dbsg,
    })

    const lambdaFunctionName = rdsPostgres.rdsInitializerLambdaName;
    const lambdaFunction = lambda.Function.fromFunctionName(this, 'LambdaFunction', lambdaFunctionName);

    // Custom resource for tenant provisioning - create new database and tables
    const provisionPayload: string = JSON.stringify({
      rdsSecretName: rdsSecretName
    })
    const provisionPayloadHashPrefix = createHash('md5').update(provisionPayload).digest('hex').substring(0, 6)

    const sdkProvisioningCall: AwsSdkCall = {
      service: 'Lambda',
      action: 'invoke',
      parameters: {
        FunctionName: lambdaFunction.functionName,
        Payload: provisionPayload
      },
      physicalResourceId: PhysicalResourceId.of(`${id}-AwsSdkCall-${lambdaFunction.latestVersion + provisionPayloadHashPrefix}`)
    }

    const provisioningCustomResourceFnRole = new iam.Role(this, 'AwsProvisioningCustomResourceRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
    })
    provisioningCustomResourceFnRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [lambdaFunction.functionArn],
        actions: ['lambda:InvokeFunction']
      })
    )
    const provisioningCustomResource = new AwsCustomResource(this, 'AwsProvisioningCustomResource', {
      policy: AwsCustomResourcePolicy.fromSdkCalls({resources: AwsCustomResourcePolicy.ANY_RESOURCE}),
      onCreate: sdkProvisioningCall,
      timeout: cdk.Duration.minutes(10),
      role: provisioningCustomResourceFnRole
    })

    provisioningCustomResource.node.addDependency(rdsPostgres)

    // Create a comma-separated string of private subnet IDs
    const privateSubnetIds = vpc.privateSubnets.map(subnet => subnet.subnetId).join(',');
    new cdk.CfnOutput(this, 'PrivateSubnets', {
      value: privateSubnetIds,
      exportName: 'PrivateSubnets',
    });
    new cdk.CfnOutput(this, `ProductReviewVpcId`, {value: vpc.vpcId, exportName: `ProductReviewVpcId`});
    new cdk.CfnOutput(this, `ProductReviewECSClusterName`, {
      value: cluster.clusterName,
      exportName: `ProductReviewECSClusterName`
    });
    // Export the ALB security group ID
    new cdk.CfnOutput(this, 'ALBSecurityGroupId', {
      value: albSecurityGroup.securityGroupId,
      exportName: 'ALBSecurityGroupId',
    });
    new cdk.CfnOutput(this, 'FargateSecurityGroupId', {
      value: fargateSecurityGroup.securityGroupId,
      exportName: 'FargateSecurityGroupId',
    });
    new cdk.CfnOutput(this, `ProductReviewALBArn`, {value: alb.loadBalancerArn, exportName: `ProductReviewALBArn`});
    new cdk.CfnOutput(this, `ProductReviewListenerArn`, {
      value: listener.listenerArn,
      exportName: `ProductReviewListenerArn`
    });
    new cdk.CfnOutput(this, `ProductReviewALBSecurityGroupId`, {
      value: alb.connections.securityGroups[0].securityGroupId,
      exportName: `ProductReviewALBSecurityGroupId`
    });
  }
}