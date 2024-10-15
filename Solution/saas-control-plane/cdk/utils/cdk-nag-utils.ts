import { NagSuppressions } from 'cdk-nag'

export class CdkNagUtils {

  static suppressCDKNag(context: any): void {
    NagSuppressions.addStackSuppressions(context, []);
  }
}