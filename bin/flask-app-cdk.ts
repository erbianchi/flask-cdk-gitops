#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { FlaskAppCdkStack } from '../lib/flask-app-cdk-stack';
import { FlaskAppECSStack } from '../lib/flask-app-ecs-stack';

const app = new cdk.App();

new FlaskAppCdkStack(app, 'FlaskAppCdkStack', {
  env: {
    // FIX ME
    account: '11111111111',
    region: 'eu-central-1'
  }
});

new FlaskAppECSStack(app, 'FlaskAppECSStack', {
  env: {
    // FIX ME
    account: '11111111111',
    region: 'eu-central-1'
  }
});