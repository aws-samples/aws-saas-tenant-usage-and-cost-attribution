import { NagSuppressions } from 'cdk-nag'

export class CdkNagUtils {

  static suppressCDKNag(context: any): void {
    NagSuppressions.addStackSuppressions(context, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWS Managed policies are permitted.'
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Allow wildcard expressions to grant permissions for multi-related actions that share a common prefix.'
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'Specify fixed lambda runtime version to ensure compatibility with application testing and deployments.'
      },
      {
        id: 'AwsSolutions-APIG4',
        reason: 'Custom request authorizer is being used.'
      },
      {
        id: 'AwsSolutions-COG4',
        reason: 'Cognito user pool authorizer unnecessary; Custom request authorizer is being used.'
      },
    ]);
  }
}