import { NagSuppressions } from 'cdk-nag'

export class CdkNagUtils {

  static suppressCDKNag(context: any): void {
    NagSuppressions.addStackSuppressions(context, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWS Managed policies are permitted.'
      },
      {
        id: 'AwsSolutions-EC26',
        reason: 'EBS encryption unnecessary.'
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Allow wildcard expressions to grant permissions for multi-related actions that share a common prefix.'
      },
      {
        id: 'AwsSolutions-VPC7',
        reason: 'VPC Flow logs unnecessary for current implementation, relying on access log from API Gateway.'
      },
      {
        id: 'AwsSolutions-AS3',
        reason: 'Notifications not required for Auto Scaling Group.'
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'Specify fixed lambda runtime version to ensure compatibility with application testing and deployments.'
      },
      {
        id: 'AwsSolutions-COG4',
        reason: 'Cognito user pool authorizer unnecessary; Custom request authorizer is being used.'
      },
      {
        id: 'AwsSolutions-SNS2',
        reason: 'Not utilizing SNS notifications.'
      },
      {
        id: 'AwsSolutions-SNS3',
        reason: 'Not utilizing SNS notifications.'
      },
      {
        id: 'AwsSolutions-S1',
        reason: 'Server access logs not required for S3 buckets.'
      },
      {
        id: 'AwsSolutions-S10',
        reason: 'SSL not required for S3 buckets collecting access logs.'
      },
      {
        id: 'AwsSolutions-EC23',
        reason: 'Security group rules are restricted to allow only necessary traffic (port 80 or 443) from ALB.'
      },
      {
        id: 'AwsSolutions-ECS2',
        reason: 'Environment variables permitted in container definitions.'
      },
      {
        id: 'AwsSolutions-ECS7',
        reason: 'Container logging not required.'
      },

    ]);
  }
}