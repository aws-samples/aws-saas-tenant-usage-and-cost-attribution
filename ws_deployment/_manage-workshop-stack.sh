#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

create_workshop() {
  get_vscodeserver_id

  echo "Waiting for " $VSSERVER_ID
  aws ec2 start-instances --instance-ids "$VSSERVER_ID"
  aws ec2 wait instance-status-ok --instance-ids "$VSSERVER_ID"
  echo $VSSERVER_ID "ready"

  run_ssm_command "export UV_USE_IO_URING=0 && npm install typescript"
  run_ssm_command "cd /${HOME_FOLDER} && git clone ${REPO_URL}"
  run_ssm_command "chown -R ${TARGET_USER}:${TARGET_USER} /${HOME_FOLDER}"
  run_ssm_command ". ~/.bashrc && cd /${HOME_FOLDER}/${REPO_NAME} && chmod +x install.sh && ./install.sh"
  run_ssm_command "chown -R ${TARGET_USER}:${TARGET_USER} /${HOME_FOLDER}"
}
