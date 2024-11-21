import { Construct } from 'constructs';
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, StackProps, Tags } from 'aws-cdk-lib';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
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
import * as lambda from "aws-cdk-lib/aws-lambda";
import { CdkNagUtils } from '../utils/cdk-nag-utils'

export class ApplicationPlaneStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Handle CDK nag suppressions.
    CdkNagUtils.suppressCDKNag(this);

    Tags.of(this).add('saas-service', 'product-media');

    const appPlaneRestAPIId = Fn.importValue('AppPlaneApiGatewayId');
    const appPlaneRestAPIRootResourceId = Fn.importValue('AppPlaneApiGatewayRootResourceId');
    const authorizerFunctionArn = Fn.importValue('AuthorizerFunctionArn');
    const stageName = 'prod';

    // Create a VPC with isolated subnets
    const vpc = new ec2.Vpc(this, 'ProductMedia_VPC', {
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

    // Create an ECS cluster
    const clusterName = 'ProductMedia_Cluster';
    const cluster = new ecs.Cluster(this, clusterName, {
      vpc: vpc,
      containerInsights: true
    });

    // Create an ECR repository
    const repository = new ecr.Repository(this, 'ProductMediaServiceRepo', {
      repositoryName: 'product-media-service',
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

    const ecsInstanceRole = new iam.Role(this, 'EcsInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'),
      ],
    });

    // User data script to install and run a simple HTTP server and configure S3 bucket name
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'yum install -y httpd',
      'echo \'Hello World\' > /var/www/html/index.html',
      'systemctl start httpd',
      'systemctl enable httpd'
    );

    // Create an Auto Scaling Group with ECS-optimized AMI
    const asg = new autoscaling.AutoScalingGroup(this, 'DefaultAutoScalingGroup', {
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.M5,
        ec2.InstanceSize.LARGE,
      ),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      vpc: vpc,
      minCapacity: 1,
      maxCapacity: 2,
      requireImdsv2: true,
      newInstancesProtectedFromScaleIn: false,
      role: ecsInstanceRole,
      userData: userData,
    });

    //create security group for auto scaling group asg
    const asgSecurityGroup = new ec2.SecurityGroup(this, 'ASGSecurityGroup', {
      vpc: vpc,
      allowAllOutbound: true
    });
    asg.addSecurityGroup(asgSecurityGroup);

    // Add the ASG as a capacity provider to the ECS cluster
    const capacityProvider = new ecs.AsgCapacityProvider(this, 'CapacityProvider', {
      autoScalingGroup: asg,
      enableManagedTerminationProtection: false
    });
    cluster.addAsgCapacityProvider(capacityProvider);

    // Create an ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ProductMediaService_ALB', {
      vpc: vpc,
      internetFacing: false,
      dropInvalidHeaderFields: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });
    alb.logAccessLogs(logBucket);

    // Add ASG as a target to ALB with an HTTP health check
    const listener = alb.addListener('PrivateListener', {
      port: 80,
      open: true
    });
    listener.addTargets('ASGTargetGroup', {
      port: 80,
      targets: [asg],
      healthCheck: {
        path: '/',
        protocol: elbv2.Protocol.HTTP,
        port: '80'
      }
    });

    // Allow incoming traffic from the ALB to the ASG
    asg.connections.allowFrom(alb, ec2.Port.tcpRange(32768, 65535), 'allow incoming traffic from ALB');

    const nlb = new elbv2.NetworkLoadBalancer(this, 'ProductMediaServiceNLB', {
      vpc: vpc,
      internetFacing: false,
      crossZoneEnabled: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });

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
    nlb.logAccessLogs(logBucket);

    const vpcLink = new VpcLink(this, 'ecs-vpc-link', {
      targets: [nlb]
    });

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
    authorizerFunction.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'))

    const requestAuthorizer = new RequestAuthorizer(this, 'TenantAPIAuthorizer', {
      handler: authorizerFunction,
      identitySources: [
        IdentitySource.header('x-service-identifier'),
        IdentitySource.header('Authorization'),
      ],
      resultsCacheTtl: Duration.seconds(30),
    });

    const methodOptions: MethodOptions = {
      authorizationType: AuthorizationType.CUSTOM,
      authorizer: requestAuthorizer,
    }

    // Add resources.
    // Create the /productmedia resource
    const productMediaResource = apiGateway.root.addResource('productmedia');

    // Create the {productId} resource under /productmedia
    const productIdResource = productMediaResource.addResource('{productId}');

    // Create the {fileName} resource under /productmedia/{productId}
    const fileNameResource = productIdResource.addResource('{fileName}');

    const integrationPOSTProductMedia = new HttpIntegration(`http://${nlb.loadBalancerDnsName}/productmedia`, {
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
    productMediaResource.addMethod("POST", integrationPOSTProductMedia, methodOptions);

    const integrationGETProductMedia = new HttpIntegration(`http://${nlb.loadBalancerDnsName}/productmedia/{productId}/{fileName}`, {
      httpMethod: 'GET',
      proxy: true,
      options: {
        connectionType: ConnectionType.VPC_LINK,
        vpcLink: vpcLink,
        requestParameters: {
          'integration.request.path.productId': 'method.request.path.productId',
          'integration.request.path.fileName': 'method.request.path.fileName',
          'integration.request.header.tenantId': 'context.authorizer.tenantId'
        }
      },
    });

    fileNameResource.addMethod('GET', integrationGETProductMedia, {
      authorizationType: AuthorizationType.CUSTOM,
      authorizer: requestAuthorizer,
      requestParameters: {
        'method.request.path.productId': true, // Include URL path parameters to ensure dynamic values are passed to backend services.
        'method.request.path.fileName': true
      }
    });

    // Deploy the new resources and methods to the prod stage.
    new Deployment(this, 'ProductMediaServiceDeployment', {api: apiGateway, stageName});

    // Create unique S3 bucket.
    const timestamp = Date.now();
    //const bucketName = `product-media-${timestamp}`;
    const s3Bucket = new s3.Bucket(this, 'S3Bucket', {
      //bucketName: bucketName,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
    });

    // Create an S3 bucket name parameter in Parameter Store
    new ssm.StringParameter(this, 'S3BucketNameParameter', {
      parameterName: '/saasunitcost/productmedia/s3BucketName',
      stringValue: s3Bucket.bucketName,
      description: 'S3 bucket name for Product Media upload application'
    });


    new CfnOutput(this, 'ECRRepository', {value: repository.repositoryName, exportName: 'ECRRepository'});
    new CfnOutput(this, 'ApplicationPlaneVpcId', {value: vpc.vpcId, exportName: 'ApplicationPlaneVpcId'});
    new CfnOutput(this, 'ApplicationPlaneClusterName', {
      value: cluster.clusterName,
      exportName: 'ApplicationPlaneClusterName'
    });
    new CfnOutput(this, 'ApplicationPlaneAsgName', {
      value: asg.autoScalingGroupName,
      exportName: 'ApplicationPlaneAsgName'
    });
    new CfnOutput(this, 'ApplicationPlaneLoadBalancerArn', {
      value: alb.loadBalancerArn,
      exportName: 'ApplicationPlaneLoadBalancerArn'
    });
    new CfnOutput(this, 'ApplicationPlaneListenerArn', {
      value: listener.listenerArn,
      exportName: 'ApplicationPlaneListenerArn'
    });
    new CfnOutput(this, 'ApplicationPlaneLoadBalancerSecurityGroupId', {
      value: alb.connections.securityGroups[0].securityGroupId,
      exportName: 'ApplicationPlaneLoadBalancerSecurityGroupId'
    });
    new CfnOutput(this, 'ProductMediaServiceS3Bucket', {
      value: s3Bucket.bucketName,
      exportName: 'ProductMediaServiceS3Bucket'
    });    
  }
}
