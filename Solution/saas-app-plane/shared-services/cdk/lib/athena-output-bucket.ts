import * as cdk from 'aws-cdk-lib';
import { aws_s3, Stack, StackProps, Tags, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as athena from 'aws-cdk-lib/aws-athena';

interface GlueCrawlerProps {
  bucket: s3.IBucket;
  role: iam.IRole;
  databaseName: string;
  crawlerName: string;
  scheduleExpression: string;
}

interface AthenaOutputBucketProps extends StackProps {
  accountId: string;
}

export class AthenaOutputBucket extends Construct {
  public readonly athenaOutputBucketName: string;
  public readonly athenaUsageBucketArn: string;

  constructor(scope: Construct, id: string, props: AthenaOutputBucketProps) {
    super(scope, id);

    // create a new s3 bucket
    const athenaOutputBucket = new aws_s3.Bucket(this, 'AthenaOutputBucket', {
      versioned: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: aws_s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL
    });

    // Update the default Athena workgroup with the new S3 output location
    const defaultWorkgroup = new athena.CfnWorkGroup(this, 'CostAttributionAthenaWorkgroup', {
      name: 'saas-cost-attribution',  // 'primary' is the name of the default workgroup
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${athenaOutputBucket.bucketName}/athena-results/`,
          encryptionConfiguration: {
            encryptionOption: 'SSE_S3',
          }
        },
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
      },
    });

    // Set the workgroup to be updated, not replaced
    defaultWorkgroup.cfnOptions.updateReplacePolicy = cdk.CfnDeletionPolicy.RETAIN;

    //cfn output
    new CfnOutput(this, 'AthenaOutputBucketName', {
      value: athenaOutputBucket.bucketName,
      exportName: 'AthenaOutputBucketName',
    });
    this.athenaOutputBucketName = athenaOutputBucket.bucketName;

    new CfnOutput(this, 'AthenaOutputBucketArn', {
      value: athenaOutputBucket.bucketArn,
      exportName: 'AthenaOutputBucketArn',
    });

    new CfnOutput(this, 'AthenaDefaultWorkgroupOutputLocation', {
      value: `s3://${athenaOutputBucket.bucketName}/athena-results/`,
      exportName: 'AthenaDefaultWorkgroupOutputLocation',
    });
    this.athenaUsageBucketArn = athenaOutputBucket.bucketArn;
  }
}
