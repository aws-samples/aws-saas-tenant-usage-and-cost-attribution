import {Stack, StackProps, Fn, Tags} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  CoreApplicationPlane,
  DetailType,
  EventManager
} from "@cdklabs/sbt-aws";
import { EventBus } from 'aws-cdk-lib/aws-events';

import { PolicyDocument } from "aws-cdk-lib/aws-iam";
import * as fs from "fs";


export class SaaSTenantProvision extends Construct {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id);

    const eventBusArn = Fn.importValue('ControlPlaneEventBusArn')

    const provisioningJobRunnerProps = {
      name: "provisioning",
      permissions: PolicyDocument.fromJson(
        JSON.parse(`
  {
    "Version":"2012-10-17",
    "Statement":[
        {
          "Action":[
              "*"
          ],
          "Resource":"*",
          "Effect":"Allow"
        }
    ]
  }
  `)
      ),
      script: fs.readFileSync("../../provision-tenant.sh", "utf8"),
      environmentJSONVariablesFromIncomingEvent: [
        "tenantId",
        "tenantName",
        "email",
        "tenantTier",
        "tenantStatus",
        "features"
      ],
      environmentVariablesToOutgoingEvent: ["tenantStatus"],
      scriptEnvironmentVariables: {},
      outgoingEvent: DetailType.PROVISION_SUCCESS,
      incomingEvent: DetailType.ONBOARDING_REQUEST,
    };

    const eventBus = EventBus.fromEventBusArn(this, 'EventBus', eventBusArn);
    const eventManagerNew = new EventManager(this, 'EventManager', {
        eventBus: eventBus,
      });

    new CoreApplicationPlane(this, "CoreApplicationPlane", {
      eventManager: eventManagerNew,
      jobRunnerPropsList: [provisioningJobRunnerProps],
    });
  }
}


