# frozen_string_literal: true

require 'rails_helper'
require ENV.fetch('UI_QA_SUPPORT')

RSpec.describe 'ui-qa scenario', :js, :ui_qa, type: :system do
  it 'walks the changed screens' do
    widget = create(:widget, name: 'Blue Widget')
    sign_in create(:user)

    visit widget_path(widget)
    capture 'widget-show'

    click_on 'Archive'
    capture 'archive-confirm', mobile: false
  end
end
