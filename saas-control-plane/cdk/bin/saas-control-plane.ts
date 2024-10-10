#!/usr/bin/env node
import 'source-map-support/register';
import { Aspects, App } from 'aws-cdk-lib';
import { SaaSControlPlaneStack } from '../lib/saas-control-plane-stack';
import { AwsSolutionsChecks } from 'cdk-nag'

const app = new App();
// Add the cdk-nag AwsSolutions Pack with extra verbose logging enabled.
Aspects.of(app).add(new AwsSolutionsChecks({verbose: true}));

// required input parameters
if (!process.env.CDK_PARAM_SYSTEM_ADMIN_EMAIL) {
  throw new Error("Please provide system admin email");
}

if (!process.env.CDK_PARAM_SYSTEM_ADMIN_ROLE_NAME) {
  process.env.CDK_PARAM_SYSTEM_ADMIN_ROLE_NAME = "SystemAdmin";
}

const controlPlaneStack = new SaaSControlPlaneStack(app, 'SaaSControlPlaneStack', {
  systemAdminRoleName: process.env.CDK_PARAM_SYSTEM_ADMIN_ROLE_NAME,
  systemAdminEmail: process.env.CDK_PARAM_SYSTEM_ADMIN_EMAIL,
});

