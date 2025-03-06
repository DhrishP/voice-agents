import express from "express";

class Server {
  instance: any;
  url?: string;
  port?: number;

  constructor(port: number) {
    this.port = port;
  }

  public start() {
    this.instance = express();
    this.instance.listen(this.port, () => {
      console.log(`Server is running on port ${this.port}`);
    });
    this.url = `http://localhost:${this.port}`;
  }

  public stop() {
    this.instance.close();
  }

  public getInstance() {
    return this.instance;
  }

  public getUrl() {
    return this.url;
  }
}

export default Server;
