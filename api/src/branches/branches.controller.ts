import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireAnyPermission, RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { AuthUser } from '../common/types';
import { BranchesService } from './branches.service';
import { CreateBranchDto, ShowroomPinDto, StaffDto, UpdateBranchDto } from './dto/branches.dto';
import { ParseStaffRolePipe } from './staff-role.pipe';

@ApiTags('branches')
@ApiBearerAuth()
@RequirePermissions('branch.manage')
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  list() {
    return this.branches.list();
  }

  /** Minimal branch list (no staff details) for filters and pickers. */
  @RequireAnyPermission('branch.manage', 'order.read.all', 'order.web.handle', 'product.reorder', 'user.manage', 'activity.read')
  @Get('options')
  options() {
    return this.branches.options();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.get(id);
  }

  /** Creates the branch with its manager and cashier; both accounts' credentials are returned once. */
  @Audit('branch.create', { entity: 'Branch' })
  @Post()
  create(@Body() dto: CreateBranchDto, @CurrentUser() actor: AuthUser) {
    return this.branches.create(dto, actor);
  }

  @Audit('branch.update', { entity: 'Branch', idParam: 'id' })
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(id, dto);
  }

  /** Sets the 6-digit PIN the branch's showroom screen signs in with. The PIN is never returned. */
  @Audit('branch.showroom_pin.set', { entity: 'Branch', idParam: 'id' })
  @Put(':id/showroom-pin')
  setShowroomPin(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ShowroomPinDto) {
    return this.branches.setShowroomPin(id, dto.pin);
  }

  /** Retires the current manager or cashier and creates their replacement (credentials returned once). */
  @ApiParam({ name: 'role', enum: ['manager', 'cashier'] })
  @Audit('branch.staff.replace', { entity: 'Branch', idParam: 'id' })
  @Post(':id/staff/:role/replace')
  @HttpCode(200)
  replaceStaff(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('role', ParseStaffRolePipe) role: 'BRANCH_MANAGER' | 'CASHIER',
    @Body() dto: StaffDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.branches.replaceStaff(id, role, dto, actor);
  }
}
