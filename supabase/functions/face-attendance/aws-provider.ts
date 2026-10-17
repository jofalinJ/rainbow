import {
  RekognitionClient, CreateCollectionCommand, DeleteCollectionCommand, CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand, DetectFacesCommand, IndexFacesCommand, SearchFacesByImageCommand,
} from 'npm:@aws-sdk/client-rekognition@3.1148.0';
import { STSClient, AssumeRoleCommand } from 'npm:@aws-sdk/client-sts@3.1148.0';

export function awsProvider(env: Record<string,string|undefined>) {
  const region = env.AWS_REGION || 'ap-south-1';
  const credentials = {accessKeyId:env.AWS_ACCESS_KEY_ID!,secretAccessKey:env.AWS_SECRET_ACCESS_KEY!,
    ...(env.AWS_SESSION_TOKEN ? {sessionToken:env.AWS_SESSION_TOKEN} : {})};
  const rekognition = new RekognitionClient({region,credentials,maxAttempts:2});
  const sts = new STSClient({region,credentials,maxAttempts:2});
  return {
    async createCollection(id: string) {
      await rekognition.send(new CreateCollectionCommand({CollectionId:id}));
    },
    async deleteCollection(id: string) {
      try { await rekognition.send(new DeleteCollectionCommand({CollectionId:id})); }
      catch (error) { if ((error as Error).name !== 'ResourceNotFoundException') throw error; }
    },
    async createSession() {
      const data = await rekognition.send(new CreateFaceLivenessSessionCommand({
        ClientRequestToken:crypto.randomUUID(),
        // Intentionally no S3 OutputConfig; never persist liveness photos in our bucket.
        Settings:{AuditImagesLimit:0,ChallengePreferences:[{Type:'FaceMovementAndLightChallenge'}]},
      }));
      if (!data.SessionId) throw new Error('No liveness session');
      return data.SessionId;
    },
    async browserCredentials() {
      const data = await sts.send(new AssumeRoleCommand({RoleArn:env.AWS_LIVENESS_ROLE_ARN,
        RoleSessionName:'rgc-live-'+crypto.randomUUID(),DurationSeconds:900,
        Policy:JSON.stringify({Version:'2012-10-17',Statement:[{Effect:'Allow',Action:'rekognition:StartFaceLivenessSession',Resource:'*'}]}),
      }));
      const c = data.Credentials;
      if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) throw new Error('No liveness credentials');
      return {accessKeyId:c.AccessKeyId,secretAccessKey:c.SecretAccessKey,sessionToken:c.SessionToken,expiration:c.Expiration.toISOString()};
    },
    async results(sessionId: string) {
      const result = await rekognition.send(new GetFaceLivenessSessionResultsCommand({SessionId:sessionId}));
      const image = result.ReferenceImage?.Bytes;
      let faces;
      try {
        if (result.Status === 'SUCCEEDED' && image?.length) {
          const detected = await rekognition.send(new DetectFacesCommand({Image:{Bytes:image},Attributes:['DEFAULT','FACE_OCCLUDED','SUNGLASSES']}));
          faces = detected.FaceDetails;
        }
      } catch (error) { image?.fill(0); throw error; }
      return {status:result.Status,confidence:result.Confidence,image,faces};
    },
    async match(collection: string, image: Uint8Array) {
      const data = await rekognition.send(new SearchFacesByImageCommand({CollectionId:collection,Image:{Bytes:image},
        FaceMatchThreshold:99,MaxFaces:1,QualityFilter:'AUTO'}));
      return data.FaceMatches?.[0]?.Similarity ?? 0;
    },
    async index(collection: string, image: Uint8Array) {
      const data = await rekognition.send(new IndexFacesCommand({CollectionId:collection,Image:{Bytes:image},
        MaxFaces:1,QualityFilter:'AUTO',DetectionAttributes:['DEFAULT']}));
      if (data.FaceRecords?.length !== 1 || data.UnindexedFaces?.length) throw new Error('Enrollment quality rejected');
    },
  };
}
