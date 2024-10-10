import {
    Stack,
    StackProps,
    CfnOutput,
    Tags,
    App,
    Fn,
    Duration,
    RemovalPolicy,
} from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { RDSInitializer } from './RdsInitializerConstruct';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface AuroraProps extends StackProps {
    vpc: ec2.IVpc;
    auroraClusterUsername: string;
    dbName: string;
    instanceType?: any;
    backupRetentionDays?: number;
    backupWindow?: string;
    preferredMaintenanceWindow?: string;
    ingressSources?: any[];
    description?: string;

}

export class AuroraPostgres extends Construct {
    public readonly rdsInitializerLambdaName: string;
    public readonly dbsg: ec2.SecurityGroup;
    public readonly instanceIdentifier: string;
    public readonly rdsSecretName: string;
    public readonly productReviewDBName: string;

    constructor(scope: Construct, id: string, props: AuroraProps) {
        super(scope, id);

        let instanceType = props.instanceType;
        let backupRetentionDays = props.backupRetentionDays ?? 14;


        let ingressSources = props.ingressSources;

        if (backupRetentionDays < 14) {
            backupRetentionDays = 14;
        }

        // vpc
        const vpc = props.vpc
        const isolated_subnets = vpc.isolatedSubnets;

        // all the ports
        const allAll = ec2.Port.allTraffic();
        const tcp5432 = ec2.Port.tcpRange(5432, 5432);

        let connectionPort: any;
        let connectionName: string;

        // Database Security Group
        const dbsg = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
            vpc: vpc,
            allowAllOutbound: true,
            description: id + 'Database',
            securityGroupName: id + 'Database',
        });
        dbsg.addIngressRule(dbsg, allAll, 'all from self');
        dbsg.addEgressRule(ec2.Peer.ipv4('0.0.0.0/0'), allAll, 'all out');


        connectionPort = tcp5432;
        connectionName = 'tcp5432 PostgresSQL';

        for (let ingress_source of ingressSources!) {
            dbsg.addIngressRule(ingress_source, connectionPort, connectionName);
        }

        // Declaring postgres engine
        let auroraEngine = rds.DatabaseClusterEngine.auroraPostgres({
            version: rds.AuroraPostgresEngineVersion.VER_15_4,
        });

        let auroraParameters: any = {};
        // aurora params
        const auroraParameterGroup = new rds.ParameterGroup(
            this,
            'AuroraParameterGroup',
            {
                engine: auroraEngine,
                description: id + ' Parameter Group',
                parameters: auroraParameters,
            },
        );

        const rdsSecretName = 'ProductAuroraClusterCredentials'

        const auroraClusterSecret = new secretsmanager.Secret(
            this,
            'AuroraClusterCredentials',
            {
                secretName: rdsSecretName,
                description: props.dbName + `AuroraClusterCredentials`,
                generateSecretString: {
                    excludeCharacters: "\"@/\\ '",
                    generateStringKey: 'password',
                    passwordLength: 30,
                    secretStringTemplate: JSON.stringify({ username: props.auroraClusterUsername }),
                },
            },
        );

        // aurora credentials
        const auroraClusterCredentials = rds.Credentials.fromSecret(
            auroraClusterSecret,
            props.auroraClusterUsername,
        );

        if (instanceType == null || instanceType == undefined) {
            instanceType = ec2.InstanceType.of(
                ec2.InstanceClass.BURSTABLE4_GRAVITON,
                ec2.InstanceSize.SMALL,
            );
        }

        // Aurora DB Key
        const kmsKey = new kms.Key(this, 'AuroraDatabaseKey', {
            enableKeyRotation: true,
            alias: props.dbName,
        });

        let cloudwatchLogsExports: any = ['postgresql'];

        const productReviewDBName = 'saas_db'

        const rdsInitializer = new RDSInitializer(this, `RDSInitializer`, {
            vpc: vpc,
            dbCredSecretName: auroraClusterSecret.secretName,
            secretArn: auroraClusterSecret.secretArn,
            productReviewDBName: productReviewDBName
        });

        dbsg.addIngressRule(rdsInitializer.fnSg, connectionPort, connectionName);

        //a new role for enhanced monitoring to get db load metrics in performance insights
        const rdsMonitoringRole = new iam.Role(this, 'RdsMonitoringRole', {
            assumedBy: new iam.ServicePrincipal('monitoring.rds.amazonaws.com'),
        });

        rdsMonitoringRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonRDSEnhancedMonitoringRole'));


        const aurora_cluster = new rds.DatabaseCluster(this, 'AuroraDatabase', {
            engine: auroraEngine,
            credentials: auroraClusterCredentials,
            backup: {
                preferredWindow: props.backupWindow,
                retention: Duration.days(backupRetentionDays),
            },
            parameterGroup: auroraParameterGroup,
            storageEncrypted: true,
            storageEncryptionKey: kmsKey,
            deletionProtection: false,//setting this so that resource cleanup can be clean. Ideally should be true
            removalPolicy: RemovalPolicy.DESTROY,//setting this so that resource cleanup can be clean. Ideally should be something different
            copyTagsToSnapshot: true,
            cloudwatchLogsExports: cloudwatchLogsExports,
            cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
            preferredMaintenanceWindow: props.preferredMaintenanceWindow,
            instanceIdentifierBase: props.dbName,
            writer: rds.ClusterInstance.provisioned('writer',
                {
                    instanceType: instanceType,
                    enablePerformanceInsights: true, // this enables performanceInsights at instance level
                    performanceInsightRetention: rds.PerformanceInsightRetention.MONTHS_1, // need to be min 1 month for non-free tier to get DB Load Metrics
                }),
            vpc: vpc,
            vpcSubnets: {
                subnets: isolated_subnets
            },
            securityGroups: [dbsg],
            monitoringInterval: Duration.seconds(60),
            monitoringRole: rdsMonitoringRole,
        });

        aurora_cluster.applyRemovalPolicy(RemovalPolicy.DESTROY);

        this.rdsInitializerLambdaName = rdsInitializer.rdsInitializerLambdaName
        this.dbsg = dbsg;
        this.instanceIdentifier = aurora_cluster.instanceIdentifiers.toString()
        this.rdsSecretName = rdsSecretName
        this.productReviewDBName = productReviewDBName

        new CfnOutput(this, `RDSSecurityGroupId`, {
            exportName: aurora_cluster.stack.stackName + ':RDSSecurityGroupId',
            value: dbsg.securityGroupId!,
        });


        new CfnOutput(this, `RDSSecretName`, {
            exportName: aurora_cluster.stack.stackName + ':SecretName',
            value: aurora_cluster.secret?.secretName!,
        });

        new CfnOutput(this, `RDSSecretArn`, {
            exportName: aurora_cluster.stack.stackName + ':SecretArn',
            value: aurora_cluster.secret?.secretArn!,
        });


        new CfnOutput(this, `RDSInstanceIdentifiers`, {
            exportName: aurora_cluster.stack.stackName + 'InstanceIdentifiers',
            value: aurora_cluster.instanceIdentifiers.toString(),
        });

        const instance_endpoints: any = [];

        for (let ie of aurora_cluster.instanceEndpoints) {
            instance_endpoints.push(ie.hostname);
        }
        new CfnOutput(this, `RDSEndpoints`, {
            exportName: `RDSEndpoints`,
            value: instance_endpoints.toString(),
        });

        new CfnOutput(this, `RDSClusterEndpoint`, {
            exportName: `RDSClusterEndpoint`,
            value: aurora_cluster.clusterEndpoint.socketAddress,
        });

        new CfnOutput(this, `RDSClusterHost`, {
            exportName: `RDSClusterHost`,
            value: aurora_cluster.clusterEndpoint.hostname,
        });

        new CfnOutput(this, `RDSClusterPort`, {
            exportName: `RDSClusterPort`,
            value: aurora_cluster.clusterEndpoint.port.toString(),
        });



    }

}







