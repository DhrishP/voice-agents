import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Config } from "../../config/s3";

export class S3Service {
  private s3Client: S3Client;
  
  constructor() {
    this.s3Client = new S3Client({
      region: s3Config.region,
      credentials: {
        accessKeyId: s3Config.accessKeyId || "",
        secretAccessKey: s3Config.secretAccessKey || "",
      },
    });
  }
  async uploadFile(key: string, body: Buffer, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: s3Config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await this.s3Client.send(command);
    
    return `https://${s3Config.bucket}.s3.${s3Config.region}.amazonaws.com/${key}`;
  }
}

export default new S3Service();