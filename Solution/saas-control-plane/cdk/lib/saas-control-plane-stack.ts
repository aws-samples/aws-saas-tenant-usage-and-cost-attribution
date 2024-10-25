import { Stack, StackProps, Tags, CfnOutput } from 'aws-cdk-lib'; 
import { Construct } from 'constructs';
import { ControlPlane, CognitoAuth } from "@cdklabs/sbt-aws";
import { CdkNagUtils } from '../utils/cdk-nag-utils'

interface ControlPlaneStackProps extends StackProps {
  readonly systemAdminRoleName: string;
  readonly systemAdminEmail: string;
}

export class SaaSControlPlaneStack extends Stack {
  
  constructor(scope: Construct, id: string, props: ControlPlaneStackProps) {
    super(scope, id, props);

    // Handle CDK nag suppressions.
    CdkNagUtils.suppressCDKNag(this);

    Tags.of(this).add('saas-service', 'tenant-management');

    const cognitoAuth = new CognitoAuth(this, "CognitoAuth", {      
      systemAdminRoleName: props.systemAdminRoleName,
      systemAdminEmail: props.systemAdminEmail,
    });

    const controlPlane = new ControlPlane(this, "ControlPlane", {
      auth: cognitoAuth,
    });
    
    new CfnOutput(this, 'ControlPlaneEventBusArn', {
      value: controlPlane.eventManager.busArn,
      exportName: 'ControlPlaneEventBusArn',
    });
    // ControlPlaneTenantDetailsTable is required to query tenants with features while doing test harness
    new CfnOutput(this, 'ControlPlaneTenantDetailsTable', {
      value: controlPlane.tables.tenantDetails.tableName,
      exportName: 'ControlPlaneTenantDetailsTable',
    });

  }
}
