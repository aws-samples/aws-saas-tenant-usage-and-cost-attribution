import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { AwsCustomResource, AwsCustomResourcePolicy, AwsSdkCall, PhysicalResourceId } from 'aws-cdk-lib/custom-resources'
import { createHash } from 'crypto'
import * as iam from 'aws-cdk-lib/aws-iam';
import { CdkNagUtils } from '../utils/cdk-nag-utils'

export interface TenantProvisioningStackProps extends cdk.StackProps {
  tenantId: string;  
}

export class TenantProvisioningStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: TenantProvisioningStackProps) {
        super(scope, id, props);

        // Handle CDK nag suppressions.
        CdkNagUtils.suppressCDKNag(this);

        cdk.Tags.of(this).add('saas-app-plane', 'product-review');
        // cdk.Tags.of(this).add('tenant-id', props.tenantId);

        const rdsHost = cdk.Fn.importValue(`RDSClusterHost`);
        const rdsPort = cdk.Fn.importValue(`RDSClusterPort`);
        const tenantRDSInitializerLambdaName = cdk.Fn.importValue(`TenantRDSInitializerLambdaName`)

        const tenantSecret = new secretsmanager.Secret(
          this,
          props.tenantId + 'Credentials',
          {
              secretName: props.tenantId + 'Credentials',
              description: props.tenantId + 'Credentials',
              generateSecretString: {
              excludeCharacters: "\"@/\\ '",
              generateStringKey: 'password',
              passwordLength: 30,
              secretStringTemplate: JSON.stringify({username: props.tenantId, host: rdsHost, port: rdsPort}),
              },
          },
      );

      const lambdaFunctionName = tenantRDSInitializerLambdaName;

      const lambdaFunction = lambda.Function.fromFunctionName(this, 'LambdaFunction', lambdaFunctionName);

      // Custom resource for tenant provisioning - create new database and tables
      const provisionPayload: string = JSON.stringify({
        tenantState: 'PROVISION',
        tenantId: props.tenantId,
        tenantSecretName: tenantSecret.secretName            
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
        policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: AwsCustomResourcePolicy.ANY_RESOURCE }),
        onCreate: sdkProvisioningCall,
        timeout: cdk.Duration.minutes(10),
        role: provisioningCustomResourceFnRole
      })



      // Custom resource for tenant deprovisioning - create new database and tables
      const deprovisionPayload: string = JSON.stringify({
        tenantState: 'DE-PROVISION',
        tenantId: props.tenantId,
        tenantSecretName: tenantSecret.secretName            
      })
      const deprovisionPayloadHashPrefix = createHash('md5').update(deprovisionPayload).digest('hex').substring(0, 6)

      const sdkDeprovisioningCall: AwsSdkCall = {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: lambdaFunction.functionName,
          Payload: deprovisionPayload
        },
        physicalResourceId: PhysicalResourceId.of(`${id}-AwsSdkCall-${lambdaFunction.latestVersion + deprovisionPayloadHashPrefix}`)
      }
      
      const deprovisioningCustomResourceFnRole = new iam.Role(this, 'AwsDeprovisioningCustomResourceRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')
      })
      provisioningCustomResourceFnRole.addToPolicy(
        new iam.PolicyStatement({
          resources: [lambdaFunction.functionArn],
          actions: ['lambda:InvokeFunction']
        })
      )
      const deprovisioningCustomResource = new AwsCustomResource(this, 'AwsDeprovisioningCustomResource', {
        policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: AwsCustomResourcePolicy.ANY_RESOURCE }),
        onCreate: sdkProvisioningCall,
        timeout: cdk.Duration.minutes(10),
        role: deprovisioningCustomResourceFnRole
      })
    }
}