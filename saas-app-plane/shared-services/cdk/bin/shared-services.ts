#!/usr/bin/env node
import 'source-map-support/register';
import { Aspects, App } from 'aws-cdk-lib';
import { SharedServicesStack } from '../lib/shared-services-stack';
import { AwsSolutionsChecks } from 'cdk-nag'

const app = new App();

// Add the cdk-nag AwsSolutions Pack with extra verbose logging enabled.
Aspects.of(app).add(new AwsSolutionsChecks({verbose: true}));

new SharedServicesStack(app, 'SharedServicesStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});