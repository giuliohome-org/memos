package test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

func TestUserSettingCalendarPreferences(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "calendaruser")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	name := fmt.Sprintf("users/%d/settings/GENERAL", user.ID)

	update := func(general *v1pb.UserSetting_GeneralSetting, paths ...string) *v1pb.UserSetting_GeneralSetting {
		setting, err := ts.Service.UpdateUserSetting(userCtx, &v1pb.UpdateUserSettingRequest{
			Setting:    &v1pb.UserSetting{Name: name, Value: &v1pb.UserSetting_GeneralSetting_{GeneralSetting: general}},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: paths},
		})
		require.NoError(t, err)
		return setting.GetGeneralSetting()
	}

	general := update(&v1pb.UserSetting_GeneralSetting{
		TagStyles: map[string]*v1pb.UserSetting_GeneralSetting_TagStyle{
			"sw":      {Color: "#06b6d4", Label: "  Smart working  "},
			"festivo": {Color: "#ef4444"},
			"empty":   {},
			"l104":    {Label: strings.Repeat("x", 50)},
		},
		CalendarWorkdaysOnly: true,
		CalendarAllMonths:    true,
	}, "tag_styles", "calendarWorkdaysOnly", "calendar_all_months")

	require.Len(t, general.TagStyles, 3, "tags with neither color nor label are dropped")
	require.Equal(t, "Smart working", general.TagStyles["sw"].Label)
	require.Equal(t, "#ef4444", general.TagStyles["festivo"].Color)
	require.Len(t, []rune(general.TagStyles["l104"].Label), 40)
	require.True(t, general.CalendarWorkdaysOnly)
	require.True(t, general.CalendarAllMonths)

	// Updating another field keeps the calendar preferences.
	general = update(&v1pb.UserSetting_GeneralSetting{Theme: "paper"}, "theme")
	require.Equal(t, "paper", general.Theme)
	require.Len(t, general.TagStyles, 3)
	require.True(t, general.CalendarWorkdaysOnly)

	// They come back from the store on a fresh read.
	setting, err := ts.Service.GetUserSetting(userCtx, &v1pb.GetUserSettingRequest{Name: name})
	require.NoError(t, err)
	require.Equal(t, "#06b6d4", setting.GetGeneralSetting().TagStyles["sw"].Color)

	// The whole map is replaced, so removing a tag drops it.
	general = update(&v1pb.UserSetting_GeneralSetting{
		TagStyles: map[string]*v1pb.UserSetting_GeneralSetting_TagStyle{"sw": {Color: "#06b6d4"}},
	}, "tag_styles")
	require.Len(t, general.TagStyles, 1)
	require.Empty(t, general.TagStyles["sw"].Label)
	require.True(t, general.CalendarAllMonths)
}
