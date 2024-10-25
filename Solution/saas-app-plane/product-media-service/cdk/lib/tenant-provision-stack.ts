import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { CdkNagUtils } from '../utils/cdk-nag-utils'

interface TenantProvisionStackProps extends cdk.StackProps {
  tenantId: string;
  listenerRulePriorityBase: number;
}

export class TenantProvisionStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TenantProvisionStackProps) {
    super(scope, id, props);

    // Handle CDK nag suppressions.
    CdkNagUtils.suppressCDKNag(this);

    Tags.of(this).add('saas-service', 'product-media');
    // Tags.of(this).add('tenant-id', props.tenantId);

    const {tenantId, listenerRulePriorityBase} = props;

    if (!tenantId) {
      throw new Error('tenantId context parameter is required');
    }

    // Retrieve Account ID and Region from the environment context
    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    // Import values from ApplicationPlaneStack outputs
    const vpcId = cdk.Fn.importValue('ApplicationPlaneVpcId');
    const clusterName = cdk.Fn.importValue('ApplicationPlaneClusterName');
    const lbArn = cdk.Fn.importValue('ApplicationPlaneLoadBalancerArn');
    const listenerArn = cdk.Fn.importValue('ApplicationPlaneListenerArn');
    const securityGroupId = cdk.Fn.importValue('ApplicationPlaneLoadBalancerSecurityGroupId');
    const s3BucketName = cdk.Fn.importValue('ProductMediaServiceS3Bucket');

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

    // Import Security Group
    const securityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'SecurityGroup', securityGroupId);

    // Import Load Balancer
    const lb = elbv2.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(this, 'LoadBalancer', {
      loadBalancerArn: lbArn,
      securityGroupId: securityGroupId
    });

    // Import existing listener using Listener ARN
    const listener = elbv2.ApplicationListener.fromApplicationListenerAttributes(this, 'ExistingListener', {
      listenerArn: listenerArn,
      securityGroup: securityGroup
    });

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Role for ECS task to access specific resources',
    });

    // Policy to allow fine-grained access control for S3 bucket prefixed by tenantId.
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:PutObject'],
      resources: [`arn:aws:s3:::${s3BucketName}/${tenantId}*`], //
    }));

    // Policy to allow getting parameter from SSM.
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/saasunitcost/productmedia/s3BucketName`],
    }));

    // Policy to allow CloudWatch Logs access
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: ['arn:aws:logs:*:*:log-group:/ecs/*'],
    }));

    // Create an ECS task definition with the admin role
    const taskDefinition = new ecs.Ec2TaskDefinition(this, `TaskDef_${tenantId}`, {
      executionRole: taskRole,
      taskRole: taskRole
    });

    // Add a container to the task definition
    const container = taskDefinition.addContainer('productmedia', {
      image: ecs.ContainerImage.fromRegistry(`${accountId}.dkr.ecr.${region}.amazonaws.com/product-media-service:latest`),
      cpu: 256,
      memoryLimitMiB: 512,
      environment: {
        AWS_ACCOUNT_ID: accountId,
        AWS_REGION: region
      },
      logging: ecs.LogDriver.awsLogs({ streamPrefix: 'productmedia', logRetention: 7 })
    });

    // Add port mapping to the container
    container.addPortMappings({
      containerPort: 80,
      hostPort: 0,
      protocol: ecs.Protocol.TCP
    });

    // Create an ECS service
    const service = new ecs.Ec2Service(this, 'Service', {
      cluster: cluster,
      taskDefinition: taskDefinition,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
      circuitBreaker: { enable: true, rollback: true }
    });

    // Grant the task role permissions to pull the image from ECR
    const repository = ecr.Repository.fromRepositoryArn(this, 'MyRepo', `arn:aws:ecr:${region}:${accountId}:repository/product-media-service`);
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
      targets: [service],
      healthCheck: healthCheck
    });

    // Add Listener Rule for HTTP Header and Path '/upload'
    listener.addAction('ListenerRuleUpload', {
      priority: listenerRulePriorityBase + 1,
      conditions: [
        elbv2.ListenerCondition.httpHeader('tenantId', [tenantId]),
        elbv2.ListenerCondition.pathPatterns(['/productmedia', '/productmedia/*'])
      ],
      action: elbv2.ListenerAction.forward([targetGroup])
    });

    // Add Listener Rule for HTTP Header and Path '/health'
    listener.addAction('ListenerRuleSvcHealth', {
      priority: listenerRulePriorityBase + 2,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/health'])
      ],
      action: elbv2.ListenerAction.forward([targetGroup])
    });

    // Add Listener Rule for '/'
    listener.addAction('ListenerRuleDefault', {
      priority: listenerRulePriorityBase + 3,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/'])
      ],
      action: elbv2.ListenerAction.forward([targetGroup])
    });

    // Common Tags for all Tenant Specific AWS Resources
    const commonTags = {
      TenantId: tenantId,
      "saas-app-plane": "product-media"
    };
    Object.entries(commonTags).forEach(([key, value]) => {
      Tags.of(targetGroup).add(key, value);
      Tags.of(taskDefinition).add(key, value);
      Tags.of(service).add(key, value);
      Tags.of(targetGroup).add(key, value);
    });
  }
}
