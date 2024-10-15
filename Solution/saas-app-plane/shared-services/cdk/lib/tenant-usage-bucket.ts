import { aws_s3, Stack, StackProps, Tags, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as s3 from 'aws-cdk-lib/aws-s3'

interface GlueCrawlerProps {
  bucket: s3.IBucket;
  role: iam.IRole;
  databaseName: string;
  crawlerName: string;
  scheduleExpression: string;
}

interface TenantUsageBucketProps extends StackProps {
  accountId: string;
}

export class TenantUsageBucket extends Construct {
  public readonly tenantUsageBucketName: string;
  public readonly tenantUsageBucketArn: string;

  constructor(scope: Construct, id: string, props: TenantUsageBucketProps) {
    super(scope, id);

    // create a new s3 bucket
    const tenantUsageBucket = new aws_s3.Bucket(this, 'TenantUsageBucket', {
      versioned: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: aws_s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL
    });

    const glueRole = new iam.Role(this, 'GlueCrawlerRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
    });

    // Attach the necessary policies to the Glue role
    glueRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole'));
    tenantUsageBucket.grantReadWrite(glueRole);

    // Create the Glue database.
    const glueDatabase = new glue.CfnDatabase(this, 'TenantDailyUsageGlueDatabase', {
      catalogId: props.accountId,
      databaseInput: {
        name: 'tenant_daily_usage',
      },
    });

    // Function to create a Glue Crawler
    const createGlueCrawler = (props: GlueCrawlerProps) => {
      new glue.CfnCrawler(this, props.crawlerName, {
        role: props.role.roleArn,
        databaseName: props.databaseName,
        targets: {
          s3Targets: [
            {
              path: `${props.bucket.bucketName}/`,
            },
          ],
        },
        tablePrefix: 'tenant_usage_',
        schedule: {
          scheduleExpression: props.scheduleExpression, // Schedule for automatic runs
        },
      });
    };

    // Create Glue Crawlers for coarse and fine grained prefixes.
    createGlueCrawler({
      bucket: tenantUsageBucket,
      role: glueRole,
      databaseName: glueDatabase.ref,
      crawlerName: 'tenant-usage-crawler',
      scheduleExpression: 'cron(0 12 * * ? *)', // Every day at 12:00 UTC
    });

    //cfn output
    new CfnOutput(this, 'TenantUsageBucketName', {
      value: tenantUsageBucket.bucketName,
      exportName: 'TenantUsageBucketName',
    });
    this.tenantUsageBucketName = tenantUsageBucket.bucketName;

    new CfnOutput(this, 'TenantUsageBucketArn', {
      value: tenantUsageBucket.bucketArn,
      exportName: 'TenantUsageBucketArn',
    });
    this.tenantUsageBucketArn = tenantUsageBucket.bucketArn;
  }
}
