/**
 * Thin server layer — mirrors DatasetTreeServer style.
 * Controllers only validate/delegate; no business logic.
 */

import type {
  BusiNodeRequest,
  BusiNodeVO,
  ChartQueryRequest,
  ChartQueryResult,
  ChartViewSaveRequest,
  ChartViewVO,
  DashboardBarVO,
  DashboardComponentVO,
  DashboardComponentsUpdateRequest,
  DashboardCreateRequest,
  DashboardDetailVO,
  DashboardLayoutUpdateRequest,
  DashboardLayoutVO,
  DashboardLinkageVO,
  DashboardMoveRequest,
  DashboardNodeVO,
  DashboardRenameRequest,
  DashboardStatusVO,
  ViewMode
} from '../../frontend/types/dashboard'
import { ChartQueryManage } from '../manage/ChartQueryManage'
import { DashboardCanvasManage } from '../manage/DashboardCanvasManage'
import { DashboardPublishManage } from '../manage/DashboardPublishManage'
import { DashboardTreeManage } from '../manage/DashboardTreeManage'

export class DashboardTreeServer {
  constructor(private readonly manage = new DashboardTreeManage()) {}

  tree(request: BusiNodeRequest): BusiNodeVO[] {
    return this.manage.tree(request)
  }
  create(req: DashboardCreateRequest): DashboardNodeVO {
    return this.manage.create(req)
  }
  rename(req: DashboardRenameRequest): DashboardNodeVO {
    return this.manage.rename(req)
  }
  move(req: DashboardMoveRequest): DashboardNodeVO {
    return this.manage.move(req)
  }
  perDelete(id: string): boolean {
    return this.manage.perDelete(id)
  }
  delete(id: string): void {
    this.manage.delete(id)
  }
  barInfo(id: string): DashboardBarVO {
    return this.manage.barInfo(id)
  }
}

export class DashboardCanvasServer {
  constructor(private readonly manage = new DashboardCanvasManage()) {}

  get(id: string, view: ViewMode = 'draft'): DashboardDetailVO {
    return this.manage.getDetail(id, view)
  }
  updateLayout(id: string, req: DashboardLayoutUpdateRequest): DashboardLayoutVO {
    return this.manage.updateLayout(id, req)
  }
  updateComponents(id: string, req: DashboardComponentsUpdateRequest): DashboardComponentVO[] {
    return this.manage.updateComponents(id, req)
  }
  saveChart(id: string, chartId: string, req: ChartViewSaveRequest): ChartViewVO {
    return this.manage.saveChart(id, chartId, req)
  }
  getLinkages(id: string, view: ViewMode = 'draft'): DashboardLinkageVO[] {
    return this.manage.getLinkages(id, view)
  }
  putLinkages(id: string, linkages: DashboardLinkageVO[]): DashboardLinkageVO[] {
    return this.manage.putLinkages(id, linkages)
  }
}

export class DashboardPublishServer {
  constructor(private readonly manage = new DashboardPublishManage()) {}

  publish(id: string): DashboardStatusVO {
    return this.manage.publish(id)
  }
  discardDraft(id: string): DashboardStatusVO {
    return this.manage.discardDraft(id)
  }
  status(id: string): DashboardStatusVO {
    return this.manage.status(id)
  }
}

export class ChartQueryServer {
  constructor(private readonly manage = new ChartQueryManage()) {}

  query(req: ChartQueryRequest): ChartQueryResult {
    return this.manage.query(req)
  }
}
