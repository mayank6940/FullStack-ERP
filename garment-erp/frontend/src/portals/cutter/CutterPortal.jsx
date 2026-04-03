import React from 'react';
import MobileLayout from '../../components/MobileLayout';
import WorkerPortalScreen from '../../components/WorkerPortalScreen';

const CutterPortal = () => {
  return (
    <MobileLayout role="CUTTER">
      <WorkerPortalScreen
        role="CUTTER"
        titleKey="worker.cutterSubtitle"
        issueTypes={['WRONG_FABRIC_RECEIVED', 'FABRIC_QUANTITY_SHORT', 'PATTERN_UNCLEAR', 'OTHER']}
        startStatuses={['FABRIC_DONE']}
        startToStatus="CUTTING_IN_PROGRESS"
        doneStatus="CUTTING_IN_PROGRESS"
        doneToStatus="CUTTING_DONE"
        successMessageKey="worker.cutterSuccess"
        subtitleGetter={(order) => order.details?.pattern || order.details?.companyFields?.Pattern || '-'}
      />
    </MobileLayout>
  );
};

export default CutterPortal;
