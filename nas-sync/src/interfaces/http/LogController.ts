import { Router, Request, Response } from 'express';
import { LogUseCase } from '../../application/LogUseCase';

/**
 * 日志Controller
 */
export class LogController {

  readonly router = Router();

  constructor(private readonly useCase: LogUseCase) {
    this.router.get('/',    this.getLogs.bind(this));
    this.router.delete('/', this.clearLogs.bind(this));
  }

  private async getLogs(req: Request, res: Response) {
    const { event, status, q } = req.query as any;
    const logs = await this.useCase.getLogs({ event, status, q });
    res.json(logs.map(l => l.toJSON()));
  }

  private async clearLogs(req: Request, res: Response) {
    await this.useCase.clearLogs();
    res.json({ ok: true });
  }
}
