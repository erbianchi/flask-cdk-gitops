import { App, Tags, Stack, StackProps } from 'aws-cdk-lib';
import { AutoScalingGroup } from '@aws-cdk/aws-autoscaling';
import { Construct } from 'constructs';

import cdk = require('@aws-cdk/core');
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as elasticloadbalancingv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

const httpPort = ec2.Port.tcp(80);
const httpsPort = ec2.Port.tcp(443);

export class FlaskAppCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const buildRole = new iam.Role(this, 'build-role', {
      roleName:  "build-role",
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal("codepipeline.amazonaws.com"),
        new iam.ServicePrincipal("codebuild.amazonaws.com")),
    });

    // !FIX ME - DON'T DO THAT IN PRODUCTION!
    buildRole.attachInlinePolicy(
      new iam.Policy(this, "build-role-policy", {
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "*",
            ],
            resources: ["*"],
          })
        ],
      })
    );

    const repo = new codecommit.Repository(this, 'Repository', {
      repositoryName: 'flask-infra-repo'
    });
    
    const buildInfra = new codebuild.Project(this, 'flask-cdk-build', {
      projectName: 'flask-cdk-build',
      source: codebuild.Source.codeCommit({ 
        repository: repo, 
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_2,
        privileged: true
      }, 
      role: buildRole,
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              "npm install -g typescript",
              "npm install -g aws-cdk",
              "npm install -g ts-node",
              "npm install -g construct",
              'npm install',
            ]
          },
          build: {
            commands: [
              `cdk deploy FlaskAppECSStack --no-rollback --require-approval never`,
            ]
          }
        }
      })
    });

    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();

    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: 'CodeCommit',
      repository: repo,
      output: sourceOutput,
    });
    
    const buildInfraAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project: buildInfra,
      input: sourceOutput
    });


    // PIPELINE STAGES
    const infraPipeline = new codepipeline.Pipeline(this, 'MyInfraPipeline', {
      pipelineName: 'flask-app-cdk-pipeline',
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Build',
          actions: [buildInfraAction],
        }
      ]
    });

    Tags.of(repo).add('Project', 'flask-pipeline-demo');
    Tags.of(infraPipeline).add('Project', 'flask-pipeline-demo');
    
  }
}
