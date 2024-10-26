import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { CdkNagUtils } from '../utils/cdk-nag-utils'

export interface ECSServiceStackProps extends cdk.StackProps {
  imageVersion: "1"
  listenerRulePriorityBase: number;
}

export class ECSServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ECSServiceStackProps) {
    super(scope, id, props);

    // Handle CDK nag suppressions.
    CdkNagUtils.suppressCDKNag(this);

    cdk.Tags.of(this).add('saas-service', 'product-review');

    // Retrieve Account ID and Region from the environment context
    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    // Import values from ApplicationPlaneStack outputs
    const vpcId = cdk.Fn.importValue(`ProductReviewVpcId`);
    const clusterName = cdk.Fn.importValue(`ProductReviewECSClusterName`);
    const listenerArn = cdk.Fn.importValue(`ProductReviewListenerArn`);
    const db_name = cdk.Fn.importValue(`ProductReviewDBName`);
    const subnetIdsString = cdk.Fn.importValue('PrivateSubnets');
    const subnetIds = cdk.Fn.split(',', subnetIdsString);

    // Import VPC using the VPC ID
    const vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: vpcId,
      availabilityZones: cdk.Fn.getAzs()
    });

    // Import ECS Cluster using the Cluster Name
    const cluster = ecs.Cluster.fromClusterAttributes(this, 'Cluster', {
      clusterName: clusterName,
      vpc: vpc
    });

    // Import the ALB security group.
    const albSecurityGroupId = cdk.Fn.importValue('ALBSecurityGroupId');
    const albSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'ImportedALBSecurityGroup', albSecurityGroupId);

    // Import the Aurora database security group.
    const fargateSecurityGroupId = cdk.Fn.importValue('FargateSecurityGroupId');
    const fargateSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'FargateSecurityGroup', fargateSecurityGroupId);

    // Allow inbound traffic from the ALB security group to the Fargate tasks on port 80.
    fargateSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(80), 'Allow traffic from ALB');

    // Import existing listener using Listener ARN
    const listener = elbv2.ApplicationListener.fromApplicationListenerAttributes(this, 'ExistingListener', {
      listenerArn: listenerArn,
      securityGroup: albSecurityGroup
    });

    // ---------- ECS Service and Task
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Role for ECS task to access specific resources',
    });

    // Policy to allow getting parameter from SSM.
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "secretsmanager:GetRandomPassword",
        "secretsmanager:GetResourcePolicy",
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret",
        "secretsmanager:ListSecretVersionIds"
      ],
      resources: ["*"],
    }));

    // Create an Fargate task definition.
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefProductReview', {
      memoryLimitMiB: 1024,
      cpu: 512,
      executionRole: taskRole,
      taskRole,
    });

    // Add a container to the task definition
    const container = taskDefinition.addContainer('productreview', {
      image: ecs.ContainerImage.fromRegistry(`${accountId}.dkr.ecr.${region}.amazonaws.com/product-review-service:${props.imageVersion}`),
      cpu: 256,
      memoryLimitMiB: 512,
      environment: {
        AWS_ACCOUNT_ID: accountId,
        AWS_REGION: region,
        DATABASE_NAME: db_name,
        AWS_EMF_SERVICE_NAME: "ProductReview",
        AWS_EMF_LOG_GROUP_NAME: "ProductReviewLogGroup",
        AWS_EMF_LOG_STREAM_NAME: "ProductReview",
        AWS_EMF_AGENT_ENDPOINT: "tcp://localhost:25888",
        AWS_EMF_NAMESPACE: "saas-app"
      },
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'ProductReview',
        logGroup: new LogGroup(this, 'ProductReviewLogGroup', {
          logGroupName: `ProductReviewLogGroup`,
          removalPolicy: RemovalPolicy.DESTROY,
          retention: 7
        })
      }),
      portMappings: [
        {
          containerPort: 80,
          protocol: ecs.Protocol.TCP
        }
      ]
    });

    const cwcontainer = taskDefinition.addContainer('cwagent', {
      containerName: "cwagent",
      image: ecs.ContainerImage.fromRegistry('amazon/cloudwatch-agent:latest'),
      cpu: 256,
      memoryLimitMiB: 512,
      essential: false,
      environment: {
        CW_CONFIG_CONTENT: JSON.stringify({
          logs: {
            metrics_collected: {
              emf: {}
            }
          }
        })
      },
      portMappings: [
        {
          containerPort: 25888,
          protocol: ecs.Protocol.TCP
        }
      ],
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'cloudwatch-agent',
        logGroup: new LogGroup(this, 'CloudWatchAgentLogGroup', {
          logGroupName: `CloudWatchAgentLogGroup`,
          removalPolicy: RemovalPolicy.DESTROY,
          retention: 7
        })
      })
    })

    // Add the private subnets.
    const subnets: ec2.ISubnet[] = [];
    subnetIds.forEach((subnetId, index) => {
      subnets.push(ec2.Subnet.fromSubnetId(this, `Subnet${index}`, subnetId));
    });

    // Create the Fargate service.
    const service = new ecs.FargateService(this, 'Service', {
      cluster: cluster,
      taskDefinition: taskDefinition,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
      circuitBreaker: {enable: true, rollback: true},
      vpcSubnets: {
        subnets
      },
      securityGroups: [fargateSecurityGroup]
    });

    // Grant the task role permissions to pull the image from ECR
    const repository = ecr.Repository.fromRepositoryAttributes(this, 'ProductServiceRepo', {
      repositoryArn: `arn:aws:ecr:${region}:${accountId}:repository/product-review-service`,
      repositoryName: `product-review-service`
    });
    repository.grantPull(taskDefinition.taskRole);

    const healthCheck = {
      interval: cdk.Duration.seconds(60),
      path: '/health',
      timeout: cdk.Duration.seconds(5)
    };

    // Create a Target Group for the ECS service
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc: vpc,
      port: 80,
      targetType: elbv2.TargetType.IP,
      targets: [service],
      healthCheck: healthCheck,
    });

    // Add Listener Rule for HTTP Header and Path '/upload'
    listener.addAction('ListenerRuleUpload', {
      priority: props.listenerRulePriorityBase + 1,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/productreview', '/productreview/*'])
      ],
      action: elbv2.ListenerAction.forward([targetGroup])
    });

    // Add Listener Rule for HTTP Header and Path '/health'
    listener.addAction('ListenerRuleSvcHealth', {
      priority: props.listenerRulePriorityBase + 2,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/health'])
      ],
      action: elbv2.ListenerAction.forward([targetGroup])
    });

    // Add Listener Rule for '/'
    listener.addAction('ListenerRuleDefault', {
      priority: props.listenerRulePriorityBase + 3,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/'])
      ],
      action: elbv2.ListenerAction.forward([targetGroup])
    });
  }
}