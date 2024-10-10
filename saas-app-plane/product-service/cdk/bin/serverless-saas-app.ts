#!/usr/bin/env node
import 'source-map-support/register';
import { Aspects, App } from 'aws-cdk-lib';
import { ServerlessSaaSAppStack } from '../lib/serverless-saas-app-stack';
import { AwsSolutionsChecks } from 'cdk-nag'

const app = new App();
// Add the cdk-nag AwsSolutions Pack with extra verbose logging enabled.
Aspects.of(app).add(new AwsSolutionsChecks({verbose: true}));

new ServerlessSaaSAppStack(app, 'ServerlessSaaSAppStack', {});