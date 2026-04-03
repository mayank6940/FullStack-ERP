import React from 'react';
import MobileLayout from '../../components/MobileLayout';
import WorkerPortalScreen from '../../components/WorkerPortalScreen';

const TailorPortal = () => {
  return (
    <MobileLayout role="TAILOR">
      <WorkerPortalScreen
        role="TAILOR"
        titleKey="worker.tailorSubtitle"
        issueTypes={['FABRIC_CUT_WRONG', 'FABRIC_QUALITY_BAD', 'MISSING_MATERIALS', 'OTHER']}
        startStatuses={['CUTTING_DONE', 'REJECTED']}
        startToStatus="TAILOR_IN_PROGRESS"
        doneStatus="TAILOR_IN_PROGRESS"
        doneToStatus="TAILOR_DONE"
        successMessageKey="worker.tailorSuccess"
        subtitleGetter={(order) => order.details?.stitchingInstructions || order.details?.articleName || '-'}
      />
    </MobileLayout>
  );
};

export default TailorPortal;
