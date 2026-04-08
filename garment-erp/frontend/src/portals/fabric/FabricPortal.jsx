import React from 'react';
import MobileLayout from '../../components/MobileLayout';
import WorkerPortalScreen from '../../components/WorkerPortalScreen';

const FabricPortal = () => {
  return (
    <MobileLayout role="FABRIC_MAN">
      <WorkerPortalScreen
        role="FABRIC_MAN"
        titleKey="worker.fabricSubtitle"
        issueTypes={['MATERIAL_SHORT', 'WRONG_MATERIAL', 'QUALITY_ISSUE', 'OTHER']}
        startStatuses={['ASSIGNED']}
        startToStatus="FABRIC_IN_PROGRESS"
        doneStatus="FABRIC_IN_PROGRESS"
        doneToStatus="FABRIC_DONE"
        successMessageKey="worker.fabricSuccess"
        subtitleGetter={(order) => order.details?.companyFields?.FabricSize || order.details?.fabricSize || '-'}
      />
    </MobileLayout>
  );
};

export default FabricPortal;
