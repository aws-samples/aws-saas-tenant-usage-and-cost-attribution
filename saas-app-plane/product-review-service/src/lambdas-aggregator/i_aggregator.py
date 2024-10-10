from abc import ABC, abstractmethod


class IAggregator(ABC):
    @abstractmethod
    def calculate_daily_attribution_by_tenant(self):
        pass

    @abstractmethod
    def apportion_overall_usage_by_tenant(self, usage_by_tenant) -> list:
        pass

    @abstractmethod
    def aggregate_tenant_usage(self, start_date_time, end_date_time) -> dict:
        pass
