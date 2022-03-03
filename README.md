**GitOps demo basd on Amazon CDK and Amazon ECS using Fargate**

## Target Architecture

This projects demonstrates some GitOps pipeline based on AWS development tools such [AWS CodeCommit](https://aws.amazon.com/fr/codecommit/), [AWS CodePipeline](https://aws.amazon.com/fr/codepipeline/) and [AWS CodeBuild](https://aws.amazon.com/fr/codebuild/). The project is deployed in 2 phases. The first phase deploys the pipeline that is used to deploy the AWS infrastructure (e.g., VPC, subnets, ECS) as well as another pipeline dedicated to the build and deployment of the docker container to be deployed on ECS. The Architecture is as follows:

![Architecture](https://github.com/erbianchi/flask-cdk-gitops/blob/main/images/gitops.png)


## Requirements

You should have a version of [cdk](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html) and `typescript`.

To initialize the project run 
```
$ npm install
$ cdk bootstrap
$ cdk deploy FlaskAppCdkStack --no-rollback --require-approval never
```

import the project in the git commit repo that was just created using:

```
$ export AWS_REGION=your_region
$ git remote add code-commit https://git-codecommit.${AWS_REGION}.amazonaws.com/v1/repos/flask-infra-repo
$ git push --set-upstream code-commit master
``` 

This will trigger the build of the whole infrastructure. Now import your application in the new flask-app repo just created. A sample flask application is available on the same github account. 
```
$ git remote add code-commit https://git-codecommit.${AWS_REGION}.amazonaws.com/v1/repos/flask-infra-repo
$ git push --set-upstream code-commit master
``` 

This will trigger the build and deployment of the container. Now you can play with both repositories to change either the app or the infrastructure.


## License (MIT)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
