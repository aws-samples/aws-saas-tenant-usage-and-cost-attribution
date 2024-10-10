import { Duration, Stack, aws_dynamodb } from 'aws-cdk-lib';
import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { IRole } from 'aws-cdk-lib/aws-iam';
import * as logs from "aws-cdk-lib/aws-logs";

//import path from "path";

export interface LambdaFunctionProps {
  entry: string;
  handler: string;
  index: string;
  powertoolsServiceName: string;
  powertoolsNamespace: string;
  logLevel: string;
  layers?: lambda.LayerVersion[];
  logGroup?: logs.LogGroup;
}

export class LambdaFunction extends Construct {
  public readonly lambdaFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaFunctionProps) {
    super(scope, id);

    const lambdaInsightsLayer = lambda_python.PythonLayerVersion.fromLayerVersionArn(
      this,
      'InsightsLayer',
      `arn:aws:lambda:${Stack.of(this).region}:580247275435:layer:LambdaInsightsExtension:38` // was originally :14 (v14)
    );
    const layers = props.layers ? [lambdaInsightsLayer, ...props.layers] : [lambdaInsightsLayer]
    const functionProps = {
      entry: props.entry,
      handler: props.handler,
      timeout: Duration.seconds(60),
      index: props.index,
      runtime: lambda.Runtime.PYTHON_3_10,
      tracing: lambda.Tracing.ACTIVE,
      layers: layers,
      logGroup: props.logGroup,
      environment: {
        POWERTOOLS_SERVICE_NAME: props.powertoolsServiceName,
        POWERTOOLS_METRICS_NAMESPACE: props.powertoolsNamespace,
        LOG_LEVEL: props.logLevel,
        DISPATCH_MIN_BATCH_SIZE: "1"
      }
    };
    if (props.logGroup) {
      functionProps.logGroup = props.logGroup;
    }

    this.lambdaFunction = new lambda_python.PythonFunction(this, 'lambdaFunction', functionProps);

    this.lambdaFunction.addAlias('live');

    this.lambdaFunction
      .metricErrors({
        period: Duration.seconds(60),
        statistic: cloudwatch.Stats.SUM,
        dimensionsMap: {
          Name: this.lambdaFunction.functionName,
          Resource: `${this.lambdaFunction.functionName}:live`,
          ExecutedVersion: this.lambdaFunction.currentVersion.version,
        },
      })
      .createAlarm(this, 'lambdaFunctionErrorAlarm', {
        threshold: 0,
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: 'lambdaFunctionErrorAlarm',
      });
  }
}
