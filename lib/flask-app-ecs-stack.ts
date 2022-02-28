import { App, Tags, Stack, StackProps, Duration } from 'aws-cdk-lib';
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
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';

const httpPort = ec2.Port.tcp(80);
const httpsPort = ec2.Port.tcp(443);

export class FlaskAppECSStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const natGatewayProvider = ec2.NatProvider.instance({
      instanceType: new ec2.InstanceType('t3a.nano'),
    });

    const vpc = new ec2.Vpc(this, 'flask-vpc',{
      natGatewayProvider,
      natGateways: 1,
      cidr: '10.0.0.0/16',
      maxAzs: 3,
      subnetConfiguration: [
        { name: 'fk-public-subnet',  cidrMask: 24, subnetType: ec2.SubnetType.PUBLIC },
        { name: 'fk-private-subnet', cidrMask: 24, subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
        { name: 'fk-secret-subnet', cidrMask: 24, subnetType: ec2.SubnetType.PRIVATE_ISOLATED }
      ],
    });

    const serviceSecurityGroup = new ec2.SecurityGroup(this, "efs-ecs-sg", { vpc, allowAllOutbound: true});
    serviceSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), httpPort, 'allow HTTP traffic from anywhere');
    serviceSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), httpsPort, 'allow HTTPs traffic from anywhere');

    const ecrRepo = new ecr.Repository(this, 'flask-ecr-rep');

    const cluster = new ecs.Cluster(this, 'ecs-cluster', { vpc });

    const taskRole = new iam.Role(this, "task-role", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      roleName: "task-role",
      description: "Role that the api task definitions use to run the api code",
    });

    taskRole.attachInlinePolicy(
      new iam.Policy(this, "task-policy", {
        statements: [
          // policies to allow access to other AWS services from within the container e.g SES (Simple Email Service)
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["SES:*"],
            resources: ["*"],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "logs:CreateLogStream",
              "logs:PutLogEvents",
              "ecr:GetAuthorizationToken",
              "ecr:BatchCheckLayerAvailability",
              "ecr:GetDownloadUrlForLayer",
              "ecr:BatchGetImage"
            ],
            resources: ["*"],
          })
        ],
      })
    );

    const taskDefinition = new ecs.FargateTaskDefinition(this, "task-def", {
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole: taskRole,
      family: "flask-app-task-def"
    });

    const container = taskDefinition.addContainer("flask-app", {
      image:  ecs.RepositoryImage.fromEcrRepository(ecrRepo, "flask-app"),
      cpu: 256,
      memoryLimitMiB: 512,
      logging: ecs.LogDriver.awsLogs({ streamPrefix: "flask-app-logs" }),
    });

    container.addPortMappings({containerPort: 8080, hostPort: 8080, protocol: ecs.Protocol.TCP});

    const fargateService = new ecs.FargateService(this, "flask-app-service", {
      cluster: cluster,
      desiredCount: 0,
      taskDefinition: taskDefinition,
      securityGroups: [serviceSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_NAT, 
      } 
    });

    const scaling = fargateService.autoScaleTaskCount({ maxCapacity: 8 });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 30,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });

    const lb = new elasticloadbalancingv2.ApplicationLoadBalancer(this, 'LB', { vpc, internetFacing: true });
    const listener = lb.addListener('Listener', { port: 80 });
    fargateService.registerLoadBalancerTargets(
      {
        containerName: 'flask-app',
        containerPort: 8080,
        newTargetGroupId: 'ECS',
        listener: ecs.ListenerConfig.applicationListener(listener, {
          protocol: elasticloadbalancingv2.ApplicationProtocol.HTTP
        }),
      },
    );

    const repo = new codecommit.Repository(this, 'Repository', {
      repositoryName: 'flask-app-repo'
    });
    
    const buildProject = new codebuild.Project(this, 'flask-docker-build', {
      projectName: 'flask-docker-build',
      source: codebuild.Source.codeCommit({ repository: repo }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_2,
        privileged: true
      },
      environmentVariables: {
        'CLUSTER_NAME': {
          value: `${cluster.clusterName}`
        },
        'ECR_REPO_URI': {
          value: `${ecrRepo.repositoryUri}`
        }
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          pre_build: {
            commands: [
              'env',
              'export TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION}'
            ]
          },
          build: {
            commands: [
              `docker build -t $ECR_REPO_URI:flask-app .`,
              '$(aws ecr get-login --no-include-email)',
              'docker push $ECR_REPO_URI:flask-app'
            ]
          },
          post_build: {
            commands: [
              'echo "In Post-Build Stage"',
              "printf '[{\"name\":\"flask-app\",\"imageUri\":\"%s\"}]' $ECR_REPO_URI:flask-app > imagedefinitions.json",
              "pwd; ls -al; cat imagedefinitions.json"
            ]
          }
        },
        artifacts: {
          files: [
            'imagedefinitions.json'
          ]
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
    
    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project: buildProject,
      input: sourceOutput,
      outputs: [buildOutput], // optional
    });

    const deployAction = new codepipeline_actions.EcsDeployAction({
      actionName: 'DeployAction',
      service: fargateService,
      imageFile: new codepipeline.ArtifactPath(buildOutput, `imagedefinitions.json`)
    });


    // PIPELINE STAGES

    const pipeline = new codepipeline.Pipeline(this, 'MyECSPipeline', {
      pipelineName: 'flask-app-ecs-pipeline',
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Build',
          actions: [buildAction],
        },
        {
          stageName: 'Deploy-to-ECS',
          actions: [deployAction],
        }
      ]
    });

    ecrRepo.grantPullPush(buildProject.role!)
    buildProject.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "ecs:DescribeCluster",
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
        ],
      resources: [`${cluster.clusterArn}`],
    }));

    Tags.of(fargateService).add('Project', 'flask-pipeline-demo');
    Tags.of(container).add('Project', 'flask-pipeline-demo');
    Tags.of(taskDefinition).add('Project', 'flask-pipeline-demo');
    Tags.of(cluster).add('Project', 'flask-pipeline-demo');
  
    Tags.of(vpc).add('Project', 'flask-pipeline-demo');
    
    Tags.of(repo).add('Project', 'flask-pipeline-demo');
    Tags.of(buildProject).add('Project', 'flask-pipeline-demo');
    Tags.of(pipeline).add('Project', 'flask-pipeline-demo');    

    /*
    const arn = 'arn:aws:acm:...';
    const certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', arn);

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'hostedZone', {
      zoneName: '',
      hostedZoneId: '',
    });
    
    new route53.ARecord(this, 'Alias', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(lb)),
      recordName: ''
    })

    const sslListener = lb.addListener('sslListener', {
      port: 443,
      certificates: [certificate],
      protocol: elasticloadbalancingv2.ApplicationProtocol.HTTPS
    })

    sslListener.addTargets('sslListener', {
      port: 8080,
      targets: [fargateService.loadBalancerTarget({
          containerName: 'flask-app',
          containerPort: 8080,
      })],
    });
    */
  }
}
